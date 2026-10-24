import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { instance, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { isAttachable } from "@/storage/upload";
import { listAlerts } from "@/server/notifications";
import { createPost, getPost, listByAuthor, listFeed } from "@/server/posts";
import { searchPosts } from "@/server/search";
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD, ITEMS, PEOPLE } from "../../scripts/demo/data";
import { seedDemo } from "../../scripts/demo/seed";

const db = () => getDb(env.DB);
const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
const auth = () => createAuth({ DB: env.DB, AUTH_SECRET: secret });
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
let NOW = Date.now();

// One database for the whole file: the seed runs once, then the checks look at what it made.
let adminId = "";
let adminPostId = "";
let result: Awaited<ReturnType<typeof seedDemo>>;
const run = (now = NOW) =>
  seedDemo({ db: db(), d1: env.DB, media: env.MEDIA, hash: async (p) => (await auth().$context).password.hash(p), password: DEMO_PASSWORD, now });

describe("the demo seed", () => {
  it("needs an admin first, and says so", async () => {
    await expect(run(NOW)).rejects.toThrow(/Finish \/setup first/);
    expect(await count("select count(*) as n from user")).toBe(0);
  });

  it("adds the people, their posts and everything on them", async () => {
    adminId = newId("user");
    await db().insert(user).values({ id: adminId, name: "Site Admin", email: "boss@example.com" });
    await db().insert(profiles).values({ userId: adminId, username: "boss", firstName: "Site", lastName: "Admin", role: "admin" });
    const made = await createPost(db(), adminId, "Welcome, everyone. This is the first post.");
    adminPostId = (made as { id: string }).id;
    // The admin posted an hour ago. The demo replies to it must all come after it.
    NOW = Date.now();
    await env.DB.prepare("update posts set created_at = ? where id = ?").bind(NOW - 3_600_000, adminPostId).run();

    result = await run(NOW);
    expect(result.already).toBe(false);
    if (result.already) return;
    expect(result.people).toBe(PEOPLE.length);
    expect(await count("select count(*) as n from user where email like ?", `%@${DEMO_EMAIL_DOMAIN}`)).toBe(PEOPLE.length);
    expect(result.posts + result.replies + result.quotes).toBe(ITEMS.length);
    expect(await count("select count(*) as n from posts where author_id != ?", adminId)).toBe(ITEMS.length);
    expect(result.pictures).toBeGreaterThan(20);
  });

  it("is safe to run again: nothing changes the second time", async () => {
    const before = await count("select count(*) as n from posts");
    expect(await run(NOW)).toEqual({ already: true });
    expect(await count("select count(*) as n from posts")).toBe(before);
  });

  it("lets every demo person sign in with the shared password", async () => {
    for (const p of PEOPLE) {
      const signedIn = await signInMember(auth(), db(), { email: `${p.username}@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD });
      expect(signedIn.ok, p.username).toBe(true);
    }
    expect((await signInMember(auth(), db(), { email: `meera_rao@${DEMO_EMAIL_DOMAIN}`, password: "not-the-password" })).ok).toBe(false);
  });

  it("makes every kind of post, with its tags, mentions, pictures, GIF, place and card", async () => {
    expect(await count("select count(*) as n from post_tags")).toBeGreaterThan(15);
    expect(await count("select count(*) as n from post_mentions")).toBeGreaterThan(5);
    expect(await count("select count(*) as n from post_media")).toBeGreaterThan(20);
    for (const size of [1, 2, 3, 4]) expect(await count("select count(*) as n from (select post_id from post_media group by post_id having count(*) = ?)", size), `${size} pictures`).toBeGreaterThan(0);
    expect(await count("select count(*) as n from post_gifs")).toBeGreaterThan(3);
    expect(await count("select count(*) as n from post_links")).toBeGreaterThan(3);
    expect(await count("select count(*) as n from posts where place is not null")).toBeGreaterThan(3);
    expect(await count("select count(*) as n from posts where quoted_post_id is not null")).toBeGreaterThan(3);
    expect(await count("select count(*) as n from posts where parent_id is not null")).toBeGreaterThan(8);
    expect(await count("select count(*) as n from likes")).toBeGreaterThan(80);
    expect(await count("select count(*) as n from bookmarks")).toBeGreaterThan(10);
    expect(await count("select count(*) as n from reposts")).toBeGreaterThan(6);
  });

  it("stores real pictures that the app would let a post keep", async () => {
    const rows = (await env.DB.prepare("select m.key as key, p.author_id as author from post_media m join posts p on p.id = m.post_id limit 12").all<{ key: string; author: string }>()).results;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(await isAttachable(env.MEDIA, row.author, "post", row.key), row.key).toBe(true);
  });

  it("keeps counters true and spreads the posts over the last three days, oldest first", async () => {
    expect(await count("select count(*) as n from posts p where like_count != (select count(*) from likes where post_id = p.id)")).toBe(0);
    expect(await count("select count(*) as n from posts p where reply_count != (select count(*) from posts r where r.parent_id = p.id and r.deleted_at is null)")).toBe(0);
    const span = await env.DB.prepare("select min(created_at) as first, max(created_at) as last from posts where author_id != ?").bind(adminId).first<{ first: number; last: number }>();
    expect(span!.first).toBeGreaterThanOrEqual(NOW - 72 * 3_600_000);
    expect(span!.last).toBeLessThan(NOW);
    expect(span!.last - span!.first).toBeGreaterThan(60 * 3_600_000);
    // A reply never comes before the post it answers, and nothing is dated in the future.
    expect(await count("select count(*) as n from posts r join posts p on p.id = r.parent_id where r.created_at <= p.created_at")).toBe(0);
    for (const table of ["likes", "bookmarks", "reposts"]) expect(await count(`select count(*) as n from ${table} where created_at > ?`, NOW), table).toBe(0);
    // Alerts about a post are dated by what caused them (follow alerts are made as the seed runs).
    expect(await count("select count(*) as n from notifications where post_id is not null and created_at > ?", NOW)).toBe(0);
  });

  it("is searchable and shows up on the feed of someone who follows people", async () => {
    const meera = (await env.DB.prepare("select user_id as id from profiles where username = 'meera_rao'").first<{ id: string }>())!.id;
    expect((await searchPosts(db(), meera, "sourdough")).items.length).toBeGreaterThan(0);
    expect((await searchPosts(db(), meera, "#cycling")).items.length).toBeGreaterThan(0);
    const feed = await listFeed(db(), meera, { scope: "following", limit: 20 });
    expect(feed.items.length).toBeGreaterThan(10);
    // Newest first.
    const times = feed.items.map((p) => p.createdAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(feed.items.some((p) => p.photos.length > 0 || p.gif || p.link || p.quote)).toBe(true);
  });

  it("keeps the private account private, with its guest list and one request waiting", async () => {
    const ids = Object.fromEntries((await env.DB.prepare("select username, user_id as id from profiles").all<{ username: string; id: string }>()).results.map((r) => [r.username, r.id]));
    const mine = await listByAuthor(db(), ids.zara_k!, ids.ananya_d!);
    expect(mine.items.length).toBeGreaterThan(0);
    // A stranger and the person still waiting see none of it.
    for (const outsider of [ids.kwame_a!, ids.jack_r!]) expect((await listByAuthor(db(), outsider, ids.ananya_d!)).items.length, outsider).toBe(0);
    expect(await count("select count(*) as n from follow_requests where target_id = ?", ids.ananya_d!)).toBe(1);
    // Nobody reposted or quoted a private post.
    expect(await count("select count(*) as n from reposts r join posts p on p.id = r.post_id where p.author_id = ?", ids.ananya_d!)).toBe(0);
    expect(await count("select count(*) as n from posts q join posts p on p.id = q.quoted_post_id where p.author_id = ?", ids.ananya_d!)).toBe(0);
  });

  it("gives the admin a lively account: followers, alerts, and replies on their own post", async () => {
    expect(await count("select count(*) as n from follows where followee_id = ?", adminId)).toBeGreaterThanOrEqual(8);
    expect(await count("select count(*) as n from follows where follower_id = ?", adminId)).toBeGreaterThanOrEqual(8);
    expect(await count("select count(*) as n from posts where parent_id = ?", adminPostId)).toBeGreaterThanOrEqual(2);
    const alerts = await listAlerts(db(), adminId, { limit: 50 });
    expect(alerts.items.length).toBeGreaterThan(5);
    expect((await getPost(db(), adminId, adminPostId))?.replyCount).toBeGreaterThanOrEqual(2);
  });

  it("only touches the demo people: the admin's own profile and the instance table are left alone", async () => {
    expect(await count("select count(*) as n from profiles where role = 'admin'")).toBe(1);
    expect(await count("select count(*) as n from invite_links")).toBe(0);
    expect(await db().select().from(instance).all()).toHaveLength(0);
  });
});
