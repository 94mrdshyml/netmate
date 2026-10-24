// Fills a local database with demo people and posts, through the same code the app uses, so counts,
// alerts, tags, mentions and search stay true. DEV AND TEST ONLY: nothing here is called by the app,
// and the command line (scripts/seed.ts) can only open the local copy of the database.

import { count, like, sql } from "drizzle-orm";
import { account, user } from "@/db/auth-schema";
import { profiles } from "@/db/schema";
import type { Db } from "@/db";
import { newId } from "@/lib/ids";
import { setBookmark } from "@/server/bookmarks";
import { setFollow } from "@/server/follows";
import { createPost, setLike, setRepost } from "@/server/posts";
import { answerFollowRequest, setPrivate } from "@/server/privacy";
import { uploadPicture } from "@/storage/upload";
import { ADMIN_FOLLOWS, DEMO_EMAIL_DOMAIN, FOLLOW_ADMIN, GIFS, ITEMS, PEOPLE, PRIVATE_APPROVED, PRIVATE_WAITING, type Item } from "./data";
import { SCENES, scenePicture } from "./pictures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type SeedDeps = {
  db: Db;
  d1: D1Database;
  media: R2Bucket;
  /** Hashes the shared demo password the way sign-in checks it. */
  hash: (password: string) => Promise<string>;
  password: string;
  /** For tests: the moment "now" is. */
  now?: number;
};

export type SeedResult =
  | { already: true }
  | { already: false; people: number; posts: number; replies: number; quotes: number; reposts: number; likes: number; saves: number; pictures: number; follows: number };

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function seedDemo(deps: SeedDeps): Promise<SeedResult> {
  const { db, d1, media } = deps;
  const now = deps.now ?? Date.now();

  const existing = (await db.select({ n: count() }).from(user).where(like(user.email, `%@${DEMO_EMAIL_DOMAIN}`)).get())?.n ?? 0;
  if (existing > 0) return { already: true };

  const admin = await db.select({ userId: profiles.userId, username: profiles.username }).from(profiles).where(sql`${profiles.role} = 'admin'`).get();
  if (!admin) throw new Error("There is no admin yet. Finish /setup first, then run this again.");

  // ---- People: the account, the sign-in and the profile, written together for each. ----
  const passwordHash = await deps.hash(deps.password);
  const ids = new Map<string, string>();
  const people = PEOPLE.map((p, i) => {
    const userId = newId("user");
    ids.set(p.username, userId);
    const joined = now - (40 - i * 2) * DAY;
    return { p, userId, joined };
  });
  for (const group of chunks(people, 5)) {
    await db.batch(
      group.flatMap(({ p, userId, joined }) => [
        db.insert(user).values({ id: userId, name: `${p.firstName} ${p.lastName}`, email: `${p.username}@${DEMO_EMAIL_DOMAIN}`, emailVerified: true, createdAt: new Date(joined), updatedAt: new Date(joined) }),
        db.insert(account).values({ id: newId("account"), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: new Date(joined), updatedAt: new Date(joined) }),
        db.insert(profiles).values({
          userId,
          username: p.username,
          firstName: p.firstName,
          lastName: p.lastName,
          bio: p.bio,
          location: p.location,
          link: p.link ?? null,
          status: "active",
          invitedBy: admin.userId,
          createdAt: new Date(joined),
        }),
      ]) as unknown as Parameters<Db["batch"]>[0],
    );
  }
  const idOf = (username: string): string => {
    const id = ids.get(username);
    if (!id) throw new Error(`Unknown demo person: ${username}`);
    return id;
  };
  const privateUsers = PEOPLE.filter((p) => p.private).map((p) => p.username);

  // ---- Follows: a loop of friends, the admin's side, and the private account's guest list. ----
  let follows = 0;
  const follow = async (from: string, to: string) => {
    const result = await setFollow(db, from, to, true);
    if (result.ok && result.state === "following") follows++;
    return result;
  };
  const names = PEOPLE.map((p) => p.username);
  for (const [i, name] of names.entries()) {
    for (const step of [1, 2, 3, 5]) {
      const target = names[(i + step) % names.length]!;
      if (target === name || privateUsers.includes(target)) continue;
      await follow(idOf(name), idOf(target));
    }
  }
  for (const name of ADMIN_FOLLOWS) await follow(admin.userId, idOf(name));
  for (const name of FOLLOW_ADMIN) await follow(idOf(name), admin.userId);
  for (const p of PEOPLE.filter((q) => q.private)) {
    await setPrivate(db, idOf(p.username), true);
    for (const name of [...PRIVATE_APPROVED, ...PRIVATE_WAITING]) await setFollow(db, idOf(name), idOf(p.username), true);
    for (const name of PRIVATE_APPROVED) {
      await answerFollowRequest(db, idOf(p.username), idOf(name), true);
      follows++;
    }
  }

  // ---- Posts, replies and quotes, oldest first, then likes, saves and reposts. ----
  const adminPost = await d1
    .prepare("select id, created_at as createdAt from posts where author_id = ? and parent_id is null and deleted_at is null order by created_at desc limit 1")
    .bind(admin.userId)
    .first<{ id: string; createdAt: number }>();
  let greetings = 0;
  const postIds = new Map<string, string>();
  const when = new Map<string, number>();
  const start = now - 72 * HOUR;
  const gap = (70 * HOUR) / ITEMS.length;
  const counts = { posts: 0, replies: 0, quotes: 0, reposts: 0, likes: 0, saves: 0, pictures: 0 };
  const likeTimes: { userId: string; postId: string; at: number }[] = [];
  const saveTimes: { userId: string; postId: string; at: number }[] = [];
  const repostTimes: { userId: string; postId: string; at: number }[] = [];

  for (const [index, item] of ITEMS.entries()) {
    const authorId = idOf(item.as);
    let at = Math.round(start + index * gap + ((index * 7919) % 10) * (gap / 20));

    const keys: string[] = [];
    for (const [n, scene] of (item.pics ?? []).entries()) {
      const bytes = scenePicture(scene, index + n + SCENES.indexOf(scene), 960, scene === "skyline" ? 720 : 640);
      const file = new File([new Uint8Array(bytes)], "demo.png", { type: "image/png" });
      const stored = await uploadPicture(media, authorId, "post", file);
      if (!stored.ok) throw new Error(`Could not store a picture for "${item.text.slice(0, 40)}": ${stored.message}`);
      keys.push(stored.key);
      counts.pictures++;
    }

    let parentId: string | undefined;
    if (item.reply === "admin") {
      parentId = adminPost?.id;
      // A reply never comes before the admin's own post. Later than that, or left at the moment it was made.
      if (adminPost) at = Math.max(at, adminPost.createdAt + (++greetings) * 7 * MINUTE);
    }
    else if (item.reply) parentId = postIds.get(item.reply);
    if (item.reply && item.reply !== "admin" && !parentId) throw new Error(`A reply points at "${item.reply}", which comes later or does not exist.`);
    const quotedId = item.quote ? postIds.get(item.quote) : undefined;
    if (item.quote && !quotedId) throw new Error(`A quote points at "${item.quote}", which comes later or does not exist.`);

    const text = item.text.replaceAll("{admin}", admin.username);
    const result = await createPost(db, authorId, text, parentId, keys, item.place, item.gif ? GIFS[item.gif] : undefined, quotedId, item.link);
    if (!result.ok) throw new Error(`Could not post "${text.slice(0, 50)}": ${result.code}`);
    postIds.set(item.id ?? `item-${index}`, result.id);
    if (at < now - MINUTE) when.set(result.id, at);
    if (parentId) counts.replies++;
    else if (quotedId) counts.quotes++;
    else counts.posts++;
    await react(item, result.id, at);
  }

  async function react(item: Item, postId: string, at: number) {
    for (const [k, name] of (item.likes ?? []).entries()) {
      if (name === item.as) continue;
      const done = await setLike(db, idOf(name), postId, true);
      if (done.ok) {
        counts.likes++;
        likeTimes.push({ userId: idOf(name), postId, at: Math.min(now - MINUTE, at + 4 * MINUTE + k * 23 * MINUTE) });
      }
    }
    for (const [k, name] of (item.saves ?? []).entries()) {
      const done = await setBookmark(db, idOf(name), postId, true);
      if (done.ok) {
        counts.saves++;
        saveTimes.push({ userId: idOf(name), postId, at: Math.min(now - MINUTE, at + 30 * MINUTE + k * 41 * MINUTE) });
      }
    }
    for (const [k, name] of (item.reposts ?? []).entries()) {
      const done = await setRepost(db, idOf(name), postId, true);
      if (done.ok) {
        counts.reposts++;
        repostTimes.push({ userId: idOf(name), postId, at: Math.min(now - MINUTE, at + 45 * MINUTE + k * 67 * MINUTE) });
      }
    }
  }

  // ---- Real times. Everything above was made in the same second; spread it over the last three days. ----
  const statements: D1PreparedStatement[] = [];
  for (const [postId, at] of when) statements.push(d1.prepare("update posts set created_at = ? where id = ?").bind(at, postId));
  statements.push(d1.prepare("update post_tags set created_at = (select created_at from posts where id = post_tags.post_id)"));
  for (const t of likeTimes) statements.push(d1.prepare("update likes set created_at = ? where user_id = ? and post_id = ?").bind(t.at, t.userId, t.postId));
  for (const t of saveTimes) statements.push(d1.prepare("update bookmarks set created_at = ? where user_id = ? and post_id = ?").bind(t.at, t.userId, t.postId));
  for (const t of repostTimes) statements.push(d1.prepare("update reposts set created_at = ? where user_id = ? and post_id = ?").bind(t.at, t.userId, t.postId));
  // Each alert about a post is dated when what caused it happened.
  statements.push(
    d1
      .prepare(
        `update notifications set created_at = min(?1, coalesce(
           (select l.created_at from likes l where l.post_id = notifications.post_id and l.user_id = notifications.actor_id),
           (select r.created_at from reposts r where r.post_id = notifications.post_id and r.user_id = notifications.actor_id),
           (select p.created_at + 90000 from posts p where p.id = notifications.post_id)))
         where post_id is not null`,
      )
      .bind(now - MINUTE),
  );
  for (const group of chunks(statements, 40)) await d1.batch(group);

  return { already: false, people: PEOPLE.length, ...counts, follows };
}
