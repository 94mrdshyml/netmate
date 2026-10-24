// Demo people and posts: adds them through the same code the app uses (so counts, alerts, tags,
// mentions and search stay true) and takes them away again. Used by `bun run db:seed` on a local
// database, and by the admin's "Demo data" page on a real site (owner decision, session 45).
//
// The work is cut into steps, because one request on Cloudflare may make only about 1000 calls to
// the database and storage, and the whole demo needs more. Every step can be run twice without harm
// (people are found by their email, posts by author and words), so a step that stopped halfway can
// simply be run again.

import { and, count, eq, inArray, like } from "drizzle-orm";
import { account, user } from "@/db/auth-schema";
import { posts, profiles } from "@/db/schema";
import type { Db } from "@/db";
import { newId } from "@/lib/ids";
import { checkPostText } from "@/lib/post-text";
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

/** How many posts one step makes (about 350 database and storage calls, well under the 1000 a request may make). */
export const DEMO_CHUNK = 20;
/** The people, then the posts in chunks, then the finishing touch. */
export const DEMO_STEPS = 2 + Math.ceil(ITEMS.length / DEMO_CHUNK);

export type DemoDeps = {
  db: Db;
  d1: D1Database;
  media: R2Bucket;
  /** With both of these the demo people can sign in (local use). Without them they cannot sign in at all (a real site). */
  hash?: (password: string) => Promise<string>;
  password?: string;
  /** For tests: the moment "now" is. */
  now?: number;
};

export type Counts = { people: number; posts: number; replies: number; quotes: number; reposts: number; likes: number; saves: number; pictures: number; follows: number };
const noCounts = (): Counts => ({ people: 0, posts: 0, replies: 0, quotes: 0, reposts: 0, likes: 0, saves: 0, pictures: 0, follows: 0 });
const add = (a: Counts, b: Counts): Counts => Object.fromEntries((Object.keys(a) as (keyof Counts)[]).map((k) => [k, a[k] + b[k]])) as Counts;

export type SeedResult = ({ already: true } & Partial<Counts>) | ({ already: false } & Counts);

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

async function demoIds(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ username: profiles.username, userId: profiles.userId })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    // A demo person has BOTH the demo email domain and one of the 14 demo usernames, so nobody real is ever matched.
    .where(and(like(user.email, `%@${DEMO_EMAIL_DOMAIN}`), inArray(profiles.username, PEOPLE.map((p) => p.username))));
  return new Map(rows.map((r) => [r.username, r.userId]));
}

async function adminOf(db: Db): Promise<{ userId: string; username: string }> {
  const admin = await db.select({ userId: profiles.userId, username: profiles.username }).from(profiles).where(eq(profiles.role, "admin")).get();
  if (!admin) throw new Error("There is no admin yet. Finish /setup first, then run this again.");
  return admin;
}

/** How many demo people and posts are in the database right now. */
export async function demoStatus(db: Db): Promise<{ people: number; posts: number }> {
  const ids = [...(await demoIds(db)).values()];
  if (ids.length === 0) return { people: 0, posts: 0 };
  const n = (await db.select({ n: count() }).from(posts).where(inArray(posts.authorId, ids)).get())?.n ?? 0;
  return { people: ids.length, posts: n };
}

/** Runs one step (0 to DEMO_STEPS - 1). `base` is the moment step 0 started: every step dates the posts from it. */
export async function runDemoStep(deps: DemoDeps, step: number, base: number): Promise<Counts> {
  if (!Number.isInteger(step) || step < 0 || step >= DEMO_STEPS) throw new Error("There is no such step.");
  if (step === 0) return peopleStep(deps, base);
  if (step === DEMO_STEPS - 1) {
    await finishStep(deps, base);
    return noCounts();
  }
  return postsStep(deps, base, (step - 1) * DEMO_CHUNK, step * DEMO_CHUNK);
}

/** All the steps in one go, for a local database or a test. */
export async function seedDemo(deps: DemoDeps): Promise<SeedResult> {
  const base = deps.now ?? Date.now();
  await adminOf(deps.db);
  if ((await demoIds(deps.db)).size > 0) return { already: true };
  let total = noCounts();
  for (let step = 0; step < DEMO_STEPS; step++) total = add(total, await runDemoStep(deps, step, base));
  return { already: false, ...total };
}

// ---- Step 0: the people, and who follows whom. ----

async function peopleStep(deps: DemoDeps, base: number): Promise<Counts> {
  const { db } = deps;
  const counts = noCounts();
  const admin = await adminOf(db);
  const have = await demoIds(db);

  const passwordHash = deps.hash && deps.password ? await deps.hash(deps.password) : null;
  const fresh = PEOPLE.map((p, i) => ({ p, userId: newId("user"), joined: base - (40 - i * 2) * DAY })).filter(({ p }) => !have.has(p.username));
  for (const group of chunks(fresh, 5)) {
    await db.batch(
      group.flatMap(({ p, userId, joined }) => [
        db.insert(user).values({ id: userId, name: `${p.firstName} ${p.lastName}`, email: `${p.username}@${DEMO_EMAIL_DOMAIN}`, emailVerified: true, createdAt: new Date(joined), updatedAt: new Date(joined) }),
        ...(passwordHash ? [db.insert(account).values({ id: newId("account"), accountId: userId, providerId: "credential", userId, password: passwordHash, createdAt: new Date(joined), updatedAt: new Date(joined) })] : []),
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
    counts.people += group.length;
  }

  const ids = await demoIds(db);
  const idOf = (username: string): string => {
    const id = ids.get(username);
    if (!id) throw new Error(`Unknown demo person: ${username}`);
    return id;
  };
  const privateUsers = PEOPLE.filter((p) => p.private).map((p) => p.username);
  const follow = async (from: string, to: string) => {
    const result = await setFollow(db, from, to, true);
    if (result.ok && result.state === "following") counts.follows++;
  };
  const names = PEOPLE.map((p) => p.username);
  for (const [i, name] of names.entries()) {
    for (const stride of [1, 2, 3, 5]) {
      const target = names[(i + stride) % names.length]!;
      if (target === name || privateUsers.includes(target)) continue;
      await follow(idOf(name), idOf(target));
    }
  }
  for (const name of ADMIN_FOLLOWS) await follow(admin.userId, idOf(name));
  for (const name of FOLLOW_ADMIN) await follow(idOf(name), admin.userId);
  for (const username of privateUsers) {
    await setPrivate(db, idOf(username), true);
    for (const name of [...PRIVATE_APPROVED, ...PRIVATE_WAITING]) await setFollow(db, idOf(name), idOf(username), true);
    for (const name of PRIVATE_APPROVED) {
      const answered = await answerFollowRequest(db, idOf(username), idOf(name), true);
      if (answered.ok) counts.follows++;
    }
  }
  return counts;
}

// ---- Steps 1 and on: posts, replies and quotes, with their likes, saves and reposts. ----

async function postsStep(deps: DemoDeps, base: number, from: number, to: number): Promise<Counts> {
  const { db, d1, media } = deps;
  const now = deps.now ?? Date.now();
  const counts = noCounts();
  const admin = await adminOf(db);
  const ids = await demoIds(db);
  const idOf = (username: string): string => {
    const id = ids.get(username);
    if (!id) throw new Error("The demo people are not all there yet. Run the first step again.");
    return id;
  };
  const textOf = (item: Item) => {
    const checked = checkPostText(item.text.replaceAll("{admin}", admin.username));
    if (!checked.ok) throw new Error(`A demo post is not valid text: ${item.text.slice(0, 40)}`);
    return checked.text;
  };
  const find = async (authorId: string, text: string) =>
    (await d1.prepare("select id from posts where author_id = ? and body = ? and deleted_at is null order by created_at limit 1").bind(authorId, text).first<{ id: string }>())?.id;
  const labels = new Map(ITEMS.flatMap((item, i) => (item.id ? [[item.id, i] as const] : [])));
  const targetOf = async (label: string) => {
    const index = labels.get(label);
    if (index === undefined) throw new Error(`A demo post points at "${label}", which does not exist.`);
    const target = ITEMS[index]!;
    const id = await find(idOf(target.as), textOf(target));
    if (!id) throw new Error(`A demo post points at "${label}", which is not made yet.`);
    return id;
  };
  const adminPost = await d1
    .prepare("select id, created_at as createdAt from posts where author_id = ? and parent_id is null and deleted_at is null order by created_at desc limit 1")
    .bind(admin.userId)
    .first<{ id: string; createdAt: number }>();
  const start = base - 72 * HOUR;
  const gap = (70 * HOUR) / ITEMS.length;

  for (let index = from; index < Math.min(to, ITEMS.length); index++) {
    const item = ITEMS[index]!;
    const authorId = idOf(item.as);
    const text = textOf(item);
    let at = Math.round(start + index * gap + ((index * 7919) % 10) * (gap / 20));

    let parentId: string | undefined;
    if (item.reply === "admin") {
      parentId = adminPost?.id;
      // A reply never comes before the admin's own post.
      if (adminPost) at = Math.max(at, adminPost.createdAt + (ITEMS.slice(0, index + 1).filter((i) => i.reply === "admin").length) * 7 * MINUTE);
    } else if (item.reply) {
      parentId = await targetOf(item.reply);
    }
    const quotedId = item.quote ? await targetOf(item.quote) : undefined;

    let postId = await find(authorId, text);
    if (!postId) {
      const keys: string[] = [];
      for (const [n, scene] of (item.pics ?? []).entries()) {
        const bytes = scenePicture(scene, index + n + SCENES.indexOf(scene), 960, scene === "skyline" ? 720 : 640);
        const stored = await uploadPicture(media, authorId, "post", new File([new Uint8Array(bytes)], "demo.png", { type: "image/png" }));
        if (!stored.ok) throw new Error(`Could not store a picture: ${stored.message}`);
        keys.push(stored.key);
        counts.pictures++;
      }
      const made = await createPost(db, authorId, text, parentId, keys, item.place, item.gif ? GIFS[item.gif] : undefined, quotedId, item.link);
      if (!made.ok) throw new Error(`Could not post "${text.slice(0, 50)}": ${made.code}`);
      postId = made.id;
      if (parentId) counts.replies++;
      else if (quotedId) counts.quotes++;
      else counts.posts++;
    }

    const updates: D1PreparedStatement[] = [];
    if (at < now - MINUTE) {
      updates.push(d1.prepare("update posts set created_at = ? where id = ?").bind(at, postId));
      updates.push(d1.prepare("update post_tags set created_at = ? where post_id = ?").bind(at, postId));
    }
    for (const [k, name] of (item.likes ?? []).entries()) {
      if (name === item.as) continue;
      const done = await setLike(db, idOf(name), postId, true);
      if (!done.ok) continue;
      counts.likes++;
      updates.push(d1.prepare("update likes set created_at = ? where user_id = ? and post_id = ?").bind(Math.min(now - MINUTE, at + 4 * MINUTE + k * 23 * MINUTE), idOf(name), postId));
    }
    for (const [k, name] of (item.saves ?? []).entries()) {
      const done = await setBookmark(db, idOf(name), postId, true);
      if (!done.ok) continue;
      counts.saves++;
      updates.push(d1.prepare("update bookmarks set created_at = ? where user_id = ? and post_id = ?").bind(Math.min(now - MINUTE, at + 30 * MINUTE + k * 41 * MINUTE), idOf(name), postId));
    }
    for (const [k, name] of (item.reposts ?? []).entries()) {
      const done = await setRepost(db, idOf(name), postId, true);
      if (!done.ok) continue;
      counts.reposts++;
      updates.push(d1.prepare("update reposts set created_at = ? where user_id = ? and post_id = ?").bind(Math.min(now - MINUTE, at + 45 * MINUTE + k * 67 * MINUTE), idOf(name), postId));
    }
    for (const group of chunks(updates, 40)) await d1.batch(group);
  }
  return counts;
}

// ---- The last step: each alert about a post is dated when what caused it happened. ----

async function finishStep(deps: DemoDeps, base: number): Promise<void> {
  const now = deps.now ?? Math.max(base, Date.now());
  await deps.d1
    .prepare(
      `update notifications set created_at = min(?1, coalesce(
         (select l.created_at from likes l where l.post_id = notifications.post_id and l.user_id = notifications.actor_id),
         (select r.created_at from reposts r where r.post_id = notifications.post_id and r.user_id = notifications.actor_id),
         (select p.created_at + 90000 from posts p where p.id = notifications.post_id)))
       where post_id is not null and actor_id in (select id from user where email like ?2)`,
    )
    .bind(now - MINUTE, `%@${DEMO_EMAIL_DOMAIN}`)
    .run();
}

// ---- Taking it all away again. ----

export type Removed = { people: number; posts: number; pictures: number };

/**
 * Removes every demo person with everything they made: posts, replies, likes, saves, reposts, follows, alerts and
 * picture files. Replies that real members wrote to a demo post go with that post (a reply cannot outlive its post).
 * The counters on the posts that stay are counted again, because the rows that fed them are gone.
 */
export async function removeDemo(deps: Pick<DemoDeps, "db" | "d1" | "media">): Promise<Removed> {
  const { db, d1, media } = deps;
  const ids = [...(await demoIds(db)).values()];
  const status = await demoStatus(db);

  let pictures = 0;
  for (const id of ids) {
    let cursor: string | undefined;
    do {
      const page = await media.list({ prefix: `posts/${id}/`, limit: 1000, cursor });
      const keys = page.objects.map((o) => o.key);
      if (keys.length > 0) {
        await media.delete(keys);
        pictures += keys.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  if (ids.length > 0) await db.delete(user).where(inArray(user.id, ids));
  await d1
    .prepare(
      `update posts set
         like_count = (select count(*) from likes where post_id = posts.id),
         reply_count = (select count(*) from posts r where r.parent_id = posts.id and r.deleted_at is null),
         repost_count = (select count(*) from reposts where post_id = posts.id)
       where like_count != (select count(*) from likes where post_id = posts.id)
          or reply_count != (select count(*) from posts r where r.parent_id = posts.id and r.deleted_at is null)
          or repost_count != (select count(*) from reposts where post_id = posts.id)`,
    )
    .run();
  return { people: status.people, posts: status.posts, pictures };
}
