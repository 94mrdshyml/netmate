import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId, randomId } from "@/lib/ids";
import type { LinkCard } from "@/links/fetch";
import { setBookmark } from "@/server/bookmarks";
import { setFollow } from "@/server/follows";
import { likePattern, listMembers, setModerator, siteStats, WEEKS } from "@/server/members";
import { createPost, deletePost, setLike, setRepost } from "@/server/posts";

const db = () => getDb(env.DB);
const DAY = 24 * 60 * 60 * 1000;
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

let n = 0;
async function person(over: { role?: "admin" | "member"; status?: "active" | "pending"; first?: string; last?: string; at?: number; moderator?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  const at = over.at ?? Date.now() - (100 - i) * 1000;
  await db().insert(user).values({ id, name: "x", email: `ma${i}@example.com` });
  await db()
    .insert(profiles)
    .values({
      userId: id,
      username: `mem_${i}`,
      firstName: over.first ?? `First${i}`,
      lastName: over.last ?? `Last${i}`,
      role: over.role ?? "member",
      status: over.status ?? "active",
      isModerator: over.moderator ?? false,
      createdAt: new Date(at),
    });
  return { id, username: `mem_${i}`, email: `ma${i}@example.com` };
}

// The database allows exactly one admin, so every test shares this one.
let sharedAdmin: Awaited<ReturnType<typeof person>> | null = null;
async function theAdmin(over: { first?: string; moderator?: boolean } = {}) {
  sharedAdmin ??= await person({ role: "admin", first: over.first ?? "Boss" });
  if (over.moderator) await env.DB.prepare("update profiles set is_moderator = 1 where user_id = ?").bind(sharedAdmin.id).run();
  return sharedAdmin;
}

const card: LinkCard = { url: "https://news.example.com/story", title: "A headline", description: "", image: null, site: "Example News" };
const gif = { url: "https://static.klipy.com/a.gif", width: 200, height: 100, title: "A gif" };
const keys = (author: string, how: number) => Array.from({ length: how }, () => `posts/${author}/${randomId(24)}.png`);
const idOf = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;

describe("the members list", () => {
  it("counts what each person made and did, and nothing else", async () => {
    const admin = await theAdmin();
    const a = await person({ first: "Alma", last: "Counts" });
    const b = await person({ first: "Bo", last: "Counted" });

    const bPost = idOf(await createPost(db(), b.id, "Bo's first post"));
    await createPost(db(), a.id, "Alma plain post");
    await createPost(db(), a.id, "", undefined, keys(a.id, 2));
    await createPost(db(), a.id, "", undefined, [], undefined, gif);
    await createPost(db(), a.id, `read ${card.url}`, undefined, [], undefined, undefined, undefined, card);
    await createPost(db(), a.id, "Alma replies", bPost);
    await createPost(db(), a.id, "Alma quotes", undefined, [], undefined, undefined, bPost);
    const doomed = idOf(await createPost(db(), a.id, "Alma will delete this"));
    await deletePost(db(), a.id, doomed);
    await setRepost(db(), a.id, bPost, true);
    await setLike(db(), a.id, bPost, true);
    await setBookmark(db(), a.id, bPost, true);
    const aOwn = idOf(await createPost(db(), a.id, "Alma gets a like"));
    await setLike(db(), b.id, aOwn, true);
    await setFollow(db(), a.id, b.id, true);

    const page = await listMembers(db(), { isAdmin: true }, { limit: 100 });
    const rowA = page.items.find((r) => r.userId === a.id)!;
    expect(rowA.counts).toEqual({ posts: 5, replies: 1, quotes: 1, reposts: 1, pictures: 2, gifs: 1, links: 1, likesGiven: 1, likesReceived: 1, followers: 0, following: 1 });
    const rowB = page.items.find((r) => r.userId === b.id)!;
    expect(rowB.counts).toMatchObject({ posts: 1, likesGiven: 1, likesReceived: 1, followers: 1, following: 0, reposts: 0 });
    expect(page.items.find((r) => r.userId === admin.id)?.role).toBe("admin");

    // Saved posts are private: nothing in what the admin gets mentions them.
    expect(JSON.stringify(page)).not.toMatch(/bookmark|saved|saves/i);
  });

  it("gives emails only to the admin, and only the admin can search by email", async () => {
    const p = await person({ first: "Mailable" });
    const asAdmin = await listMembers(db(), { isAdmin: true }, { query: p.email });
    expect(asAdmin.items.map((r) => r.userId)).toEqual([p.id]);
    expect(asAdmin.items[0]!.email).toBe(p.email);

    const asModerator = await listMembers(db(), { isAdmin: false }, { query: p.email });
    expect(asModerator.items).toHaveLength(0);
    const byName = await listMembers(db(), { isAdmin: false }, { query: "mailable" });
    expect(byName.items.map((r) => r.userId)).toEqual([p.id]);
    expect(byName.items[0]!.email).toBeNull();
  });

  it("searches names and usernames without case, and takes % and _ literally", async () => {
    const p = await person({ first: "Zelda", last: "Quill" });
    expect((await listMembers(db(), { isAdmin: false }, { query: "ZELDA qui" })).items.map((r) => r.userId)).toEqual([p.id]);
    expect((await listMembers(db(), { isAdmin: false }, { query: p.username.toUpperCase() })).items.map((r) => r.userId)).toEqual([p.id]);
    expect((await listMembers(db(), { isAdmin: false }, { query: "%" })).items).toHaveLength(0);
    expect((await listMembers(db(), { isAdmin: false }, { query: "\\" })).items).toHaveLength(0);
    expect((await listMembers(db(), { isAdmin: false }, { query: "z_lda" })).items).toHaveLength(0);
    expect(likePattern("  50%_off\\ ")).toBe("%50\\%\\_off\\\\%");
    expect(likePattern("x".repeat(80))).toBe(`%${"x".repeat(50)}%`);
  });

  it("filters moderators and people waiting, and pages newest first without repeats", async () => {
    const waiting = await person({ status: "pending", first: "Waiter" });
    const mod = await person({ moderator: true, first: "Modo" });
    const mods = await listMembers(db(), { isAdmin: true }, { filter: "moderators", limit: 100 });
    expect(mods.items.map((r) => r.userId)).toContain(mod.id);
    expect(mods.items.every((r) => r.isModerator)).toBe(true);
    const pending = await listMembers(db(), { isAdmin: true }, { filter: "pending", limit: 100 });
    expect(pending.items.map((r) => r.userId)).toContain(waiting.id);
    expect(pending.items.every((r) => r.status === "pending")).toBe(true);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listMembers>> = await listMembers(db(), { isAdmin: true }, { limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((r) => r.userId));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(await count("select count(*) as n from profiles"));
    const times = (await listMembers(db(), { isAdmin: true }, { limit: 100 })).items.map((r) => r.joinedAt);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    // A made-up cursor means the first page, not an error.
    expect((await listMembers(db(), { isAdmin: true }, { cursor: "nonsense", limit: 3 })).items).toHaveLength(3);
  });
});

describe("moderators", () => {
  it("can be made and taken back, saying the state wanted", async () => {
    const p = await person();
    expect(await setModerator(db(), p.id, true)).toEqual({ ok: true, moderator: true });
    expect(await setModerator(db(), p.id, true)).toEqual({ ok: true, moderator: true });
    expect((await listMembers(db(), { isAdmin: true }, { query: p.username })).items[0]!.isModerator).toBe(true);
    expect(await setModerator(db(), p.id, false)).toEqual({ ok: true, moderator: false });
    expect(await setModerator(db(), p.id, false)).toEqual({ ok: true, moderator: false });
    expect((await listMembers(db(), { isAdmin: true }, { query: p.username })).items[0]!.isModerator).toBe(false);
  });

  it("never applies to the admin, to someone waiting, or to someone who does not exist", async () => {
    const admin = await theAdmin();
    const waiting = await person({ status: "pending" });
    expect(await setModerator(db(), admin.id, true)).toEqual({ ok: false, code: "admin" });
    expect(await count("select is_moderator as n from profiles where user_id = ?", admin.id)).toBe(0);
    expect(await setModerator(db(), waiting.id, true)).toEqual({ ok: false, code: "pending" });
    expect(await setModerator(db(), newId("user"), true)).toEqual({ ok: false, code: "not_found" });
    expect(await setModerator(db(), "nonsense", true)).toEqual({ ok: false, code: "not_found" });
    expect(await setModerator(db(), waiting.id, "yes")).toEqual({ ok: false, code: "not_found" });
  });

  it("is never shown on the admin, even if the flag was set by hand", async () => {
    const admin = await theAdmin({ moderator: true });
    expect((await listMembers(db(), { isAdmin: true }, { query: admin.username })).items[0]!.isModerator).toBe(false);
  });

  it("is refused by the database for any value but 0 or 1", async () => {
    const p = await person();
    await expect(env.DB.prepare("update profiles set is_moderator = 2 where user_id = ?").bind(p.id).run()).rejects.toThrow();
  });
});

describe("the numbers for the whole community", () => {
  it("add up what exists, count the last eight weeks, and leave saves out", async () => {
    const now = Date.now();
    const before = await siteStats(db(), now);

    const author = await person({ first: "Weekly", at: now - 2 * DAY });
    await person({ first: "Ancient", at: now - 90 * DAY });
    await person({ status: "pending", first: "NotYet", at: now - 1 * DAY });

    const recent = idOf(await createPost(db(), author.id, "A recent post"));
    const lastWeek = idOf(await createPost(db(), author.id, "A post from last week"));
    const ancient = idOf(await createPost(db(), author.id, "A post from long ago"));
    const reply = idOf(await createPost(db(), author.id, "A recent reply", recent));
    await setLike(db(), author.id, recent, true);
    await setBookmark(db(), author.id, recent, true);
    await env.DB.prepare("update posts set created_at = ? where id = ?").bind(now - 1 * DAY, recent).run();
    await env.DB.prepare("update posts set created_at = ? where id = ?").bind(now - 9 * DAY, lastWeek).run();
    await env.DB.prepare("update posts set created_at = ? where id = ?").bind(now - 100 * DAY, ancient).run();
    await env.DB.prepare("update posts set created_at = ? where id = ?").bind(now - 1 * DAY, reply).run();
    await env.DB.prepare("update likes set created_at = ? where post_id = ?").bind(now - 1 * DAY, recent).run();

    const after = await siteStats(db(), now);
    // Totals: the three top-level posts (the old one counts, it is only outside the weekly table), one reply, one like.
    expect(after.content.posts - before.content.posts).toBe(3);
    expect(after.content.replies - before.content.replies).toBe(1);
    expect(after.interactions.likes - before.interactions.likes).toBe(1);
    expect(after.members.active - before.members.active).toBe(2);
    expect(after.members.pending - before.members.pending).toBe(1);

    // The weekly table: the recent post, reply and like are in the last 7 days, the 9-day-old post is in the week before,
    // the 100-day-old post and the 90-day-old member are outside, and someone waiting is not a new member.
    expect(after.weeks).toHaveLength(WEEKS);
    const diff = (i: number) => ({
      newMembers: after.weeks[i]!.newMembers - before.weeks[i]!.newMembers,
      posts: after.weeks[i]!.posts - before.weeks[i]!.posts,
      replies: after.weeks[i]!.replies - before.weeks[i]!.replies,
      likes: after.weeks[i]!.likes - before.weeks[i]!.likes,
    });
    expect(diff(WEEKS - 1)).toEqual({ newMembers: 1, posts: 1, replies: 1, likes: 1 });
    expect(diff(WEEKS - 2)).toEqual({ newMembers: 0, posts: 1, replies: 0, likes: 0 });
    for (let i = 0; i < WEEKS - 2; i++) expect(diff(i)).toEqual({ newMembers: 0, posts: 0, replies: 0, likes: 0 });

    expect(JSON.stringify(after)).not.toMatch(/bookmark|saved|saves/i);
  });
});
