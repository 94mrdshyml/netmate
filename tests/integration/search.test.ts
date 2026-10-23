import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { follows, posts, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createPost, deletePost } from "@/server/posts";
import { searchPeople, searchPosts, suggestPeople } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { first?: string; last?: string; username?: string; status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  const username = opts.username ?? `srch_${i}`;
  await db().insert(user).values({ id, name: "x", email: `srch${i}@example.com` });
  await db().insert(profiles).values({
    userId: id,
    username,
    firstName: opts.first ?? "Sam",
    lastName: opts.last ?? "Searcher",
    status: opts.status ?? "active",
  });
  return { id, username };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postIds = async (viewer: string, q: string) => (await searchPosts(db(), viewer, q)).items.map((p) => p.id);

describe("posts index", () => {
  it("indexes a new post and its replies, and finds them by word start", async () => {
    const a = await member();
    const root = await createPost(db(), a.id, "Quiet mornings and strong coffee");
    expect(root.ok).toBe(true);
    const id = (root as { id: string }).id;
    const reply = await createPost(db(), a.id, "Coffee beats tea every time", id);
    const replyId = (reply as { id: string }).id;

    expect(await postIds(a.id, "coff")).toEqual(expect.arrayContaining([id, replyId]));
    expect(await postIds(a.id, "morning")).toContain(id);
    expect(await postIds(a.id, "mornings coffee")).toEqual([id]);
    expect(await postIds(a.id, "zzzznothing")).toEqual([]);
  });

  it("ignores case and accents", async () => {
    const a = await member();
    const made = await createPost(db(), a.id, "Café Crème at the Müller place");
    const id = (made as { id: string }).id;
    expect(await postIds(a.id, "cafe creme")).toContain(id);
    expect(await postIds(a.id, "MULLER")).toContain(id);
    expect(await postIds(a.id, "CAFÉ")).toContain(id);
  });

  it("matches a quoted phrase only in order", async () => {
    const a = await member();
    const one = (await createPost(db(), a.id, "phrasetest alpha beta gamma")) as { id: string };
    const two = (await createPost(db(), a.id, "phrasetest beta alpha gamma")) as { id: string };
    expect(await postIds(a.id, '"alpha beta"')).toEqual([one.id]);
    expect(await postIds(a.id, "phrasetest alpha")).toEqual(expect.arrayContaining([one.id, two.id]));
  });

  it("removes a post from the index when it is deleted", async () => {
    const a = await member();
    const made = (await createPost(db(), a.id, "gonetoon vanishing words")) as { id: string };
    expect(await postIds(a.id, "gonetoon")).toEqual([made.id]);
    expect(await deletePost(db(), a.id, made.id)).toEqual({ ok: true });
    expect(await postIds(a.id, "gonetoon")).toEqual([]);
    expect(await count("select count(*) as n from posts_fts where post_id = ?", made.id)).toBe(0);
  });

  it("removes posts from the index when their author is removed", async () => {
    const a = await member();
    const made = (await createPost(db(), a.id, "cascadeword in a post")) as { id: string };
    expect(await count("select count(*) as n from posts_fts where post_id = ?", made.id)).toBe(1);
    await db().delete(user).where(eq(user.id, a.id));
    expect(await count("select count(*) as n from posts_fts where post_id = ?", made.id)).toBe(0);
  });

  it("never returns a post whose author is not an active member, even if the index still has it", async () => {
    const viewer = await member();
    const waiting = await member({ status: "pending" });
    await db().insert(posts).values({ id: newId("post"), authorId: waiting.id, body: "pendingauthorword here" });
    expect(await count("select count(*) as n from posts_fts where posts_fts match 'pendingauthorword'")).toBe(1);
    expect(await postIds(viewer.id, "pendingauthorword")).toEqual([]);
  });

  it("pages newest first by (time, id) without repeats", async () => {
    const a = await member();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(((await createPost(db(), a.id, `pagingword number ${i}`)) as { id: string }).id);

    const first = await searchPosts(db(), a.id, "pagingword", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchPosts(db(), a.id, "pagingword", { limit: 2, cursor: first.nextCursor });
    const third = await searchPosts(db(), a.id, "pagingword", { limit: 2, cursor: second.nextCursor });
    const seen = [...first.items, ...second.items, ...third.items].map((p) => p.id);
    expect(new Set(seen).size).toBe(5);
    expect(third.nextCursor).toBeNull();
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("does not crash, or change meaning, for search syntax typed by a person", async () => {
    const a = await member();
    const made = (await createPost(db(), a.id, "operatorword and otherword")) as { id: string };
    for (const q of ['operatorword"', "operatorword OR nothing", "NEAR(operatorword otherword)", "body:operatorword", "operatorword -otherword", "((", "*", "ab:", '"', "operatorword*"]) {
      await expect(searchPosts(db(), a.id, q)).resolves.toBeDefined();
    }
    // "OR" is just a word here: both words are required, so the post is not found.
    expect(await postIds(a.id, "operatorword OR nothing")).toEqual([]);
    expect(await postIds(a.id, "operatorword otherword")).toEqual([made.id]);
  });

  it("returns nothing for a query that is too short or not text", async () => {
    const a = await member();
    expect(await postIds(a.id, "a")).toEqual([]);
    expect(await postIds(a.id, "")).toEqual([]);
    expect((await searchPosts(db(), a.id, null)).items).toEqual([]);
  });
});

describe("people index", () => {
  it("finds a person by the start of username, first name or last name", async () => {
    const viewer = await member();
    const meera = await member({ first: "Meera", last: "Shahzadi", username: "meera_sh" });

    for (const q of ["meer", "@meera_sh", "shahz", "Meera Sha", "MEERA"]) {
      const found = await searchPeople(db(), viewer.id, q);
      expect(found.map((p) => p.userId), q).toContain(meera.id);
    }
    expect((await searchPeople(db(), viewer.id, "shahzadi meera")).map((p) => p.userId)).toContain(meera.id);
  });

  it("puts an exact username first, then usernames that start with the text", async () => {
    const viewer = await member();
    const prefix = await member({ first: "Zed", last: "Other", username: "rankname_two" });
    const nameOnly = await member({ first: "Rankname", last: "Person", username: "someone_else" });
    const exact = await member({ first: "Quin", last: "Exact", username: "rankname" });

    const found = (await searchPeople(db(), viewer.id, "rankname")).map((p) => p.userId);
    expect(found.slice(0, 3)).toEqual([exact.id, prefix.id, nameOnly.id]);
  });

  it("follows a name change and a removed profile", async () => {
    const viewer = await member();
    const p = await member({ first: "Oldfirst", last: "Stays", username: "renamer" });
    expect((await searchPeople(db(), viewer.id, "oldfirst")).map((x) => x.userId)).toContain(p.id);

    await env.DB.prepare("update profiles set first_name = 'Newfirst' where user_id = ?").bind(p.id).run();
    expect((await searchPeople(db(), viewer.id, "oldfirst")).map((x) => x.userId)).not.toContain(p.id);
    expect((await searchPeople(db(), viewer.id, "newfirst")).map((x) => x.userId)).toContain(p.id);
    expect(await count("select count(*) as n from profiles_fts where user_id = ?", p.id)).toBe(1);

    await env.DB.prepare("delete from profiles where user_id = ?").bind(p.id).run();
    expect(await count("select count(*) as n from profiles_fts where user_id = ?", p.id)).toBe(0);
  });

  it("skips people who are not approved yet, and says whether you follow each result", async () => {
    const viewer = await member();
    const waiting = await member({ first: "Waitingone", status: "pending" });
    const active = await member({ first: "Waitingtwo" });
    await db().insert(follows).values({ followerId: viewer.id, followeeId: active.id });

    const found = await searchPeople(db(), viewer.id, "waiting");
    expect(found.map((p) => p.userId)).toEqual([active.id]);
    expect(found[0]?.iFollow).toBe(true);
    expect(found.map((p) => p.userId)).not.toContain(waiting.id);

    // The same person is "me" in their own search.
    expect((await searchPeople(db(), active.id, "waitingtwo"))[0]?.isMe).toBe(true);
  });

  it("returns at most 20", async () => {
    const viewer = await member();
    for (let i = 0; i < 22; i++) await member({ first: "Crowdname", username: `crowd_${i}_${n}` });
    expect(await searchPeople(db(), viewer.id, "crowdname")).toHaveLength(20);
  });

  it("is safe with odd input", async () => {
    const viewer = await member();
    for (const q of ['"', "((", "a OR", "NEAR(", "@", "username:abc", "*"]) {
      await expect(searchPeople(db(), viewer.id, q)).resolves.toBeDefined();
    }
  });
});

describe("suggestPeople", () => {
  it("puts people followed by the people you follow first, and never you or anyone you already follow", async () => {
    const me = await member();
    const friend = await member();
    const friendOfFriend = await member();
    const stranger = await member();
    const already = await member();
    await db().insert(follows).values([
      { followerId: me.id, followeeId: friend.id },
      { followerId: me.id, followeeId: already.id },
      { followerId: friend.id, followeeId: friendOfFriend.id },
    ]);

    const ids = (await suggestPeople(db(), me.id, 100)).map((p) => p.userId);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(friend.id);
    expect(ids).not.toContain(already.id);
    expect(ids).toContain(stranger.id);
    expect(ids.indexOf(friendOfFriend.id)).toBe(0);
  });

  it("skips people who are not approved yet and respects the limit", async () => {
    const me = await member();
    const waiting = await member({ status: "pending" });
    await member();
    await member();
    const some = await suggestPeople(db(), me.id, 2);
    expect(some).toHaveLength(2);
    expect((await suggestPeople(db(), me.id, 100)).map((p) => p.userId)).not.toContain(waiting.id);
  });
});
