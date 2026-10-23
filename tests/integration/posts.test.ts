import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { posts, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createPost, decodeCursor, deletePost, encodeCursor, getPost, listFeed, listReplies, setLike } from "@/server/posts";

const db = () => getDb(env.DB);

let n = 0;
/** A member straight into the tables: no hashing needed to test posts. */
async function member(status: "active" | "pending" = "active") {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: `Mem ${i}`, email: `mem${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `mem_${i}`, firstName: "Mem", lastName: String(i), status });
  return id;
}

async function post(authorId: string, body = "hello", parentId?: string) {
  const res = await createPost(db(), authorId, body, parentId);
  if (!res.ok) throw new Error(`could not make post: ${res.code}`);
  return res.id;
}

const row = async (id: string) => (await db().select().from(posts).where(eq(posts.id, id)).get())!;

describe("createPost", () => {
  it("makes a top-level post with a prefixed id and zero counts", async () => {
    const a = await member();
    const id = await post(a, "  first post  ");
    expect(id).toMatch(/^post_[0-9A-Za-z]{24}$/);
    expect(await row(id)).toMatchObject({ authorId: a, body: "first post", parentId: null, replyCount: 0, likeCount: 0, deletedAt: null });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(281), "too_long"],
    ["bad\u0000text", "bad_characters"],
  ])("refuses %j", async (body, code) => {
    const a = await member();
    expect(await createPost(db(), a, body)).toEqual({ ok: false, code });
  });

  it("accepts 280 characters, and 280 emoji (the database counts them the same way)", async () => {
    const a = await member();
    expect((await createPost(db(), a, "a".repeat(280))).ok).toBe(true);
    expect((await createPost(db(), a, "😀".repeat(280))).ok).toBe(true);
  });

  it("stores text that looks like markup unchanged", async () => {
    const a = await member();
    const id = await post(a, "<img src=x onerror=alert(1)> & friends");
    expect((await row(id)).body).toBe("<img src=x onerror=alert(1)> & friends");
  });
});

describe("replies", () => {
  it("raises the parent's reply count in the same step, and keeps replies out of the feed", async () => {
    const a = await member();
    const b = await member();
    const parent = await post(a, "parent");
    const reply = await post(b, "a reply", parent);

    expect((await row(parent)).replyCount).toBe(1);
    expect((await row(reply)).parentId).toBe(parent);
    const feed = await listFeed(db(), a);
    expect(feed.items.map((p) => p.id)).toContain(parent);
    expect(feed.items.map((p) => p.id)).not.toContain(reply);
  });

  it("lists replies newest first", async () => {
    const a = await member();
    const parent = await post(a, "parent");
    const r1 = await post(a, "one", parent);
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await post(a, "two", parent);

    const replies = await listReplies(db(), a, parent);
    expect(replies.items.map((p) => p.id)).toEqual([r2, r1]);
  });

  it("refuses a reply to a post that does not exist or was deleted", async () => {
    const a = await member();
    expect(await createPost(db(), a, "hi", newId("post"))).toEqual({ ok: false, code: "parent_not_found" });
    expect(await createPost(db(), a, "hi", "not-an-id")).toEqual({ ok: false, code: "parent_not_found" });

    const parent = await post(a, "soon gone");
    await deletePost(db(), a, parent);
    expect(await createPost(db(), a, "too late", parent)).toEqual({ ok: false, code: "parent_not_found" });
  });

  it("counts several repliers correctly when they reply at the same moment", async () => {
    const a = await member();
    const parent = await post(a, "busy");
    const people = await Promise.all(Array.from({ length: 6 }, () => member()));
    await Promise.all(people.map((p) => createPost(db(), p, "me too", parent)));
    expect((await row(parent)).replyCount).toBe(6);
  });
});

describe("deletePost", () => {
  it("hides your own post everywhere but keeps the row", async () => {
    const a = await member();
    const id = await post(a, "oops");
    expect(await deletePost(db(), a, id)).toEqual({ ok: true });

    expect((await row(id)).deletedAt).not.toBeNull();
    expect(await getPost(db(), a, id)).toBeNull();
    expect((await listFeed(db(), a)).items.map((p) => p.id)).not.toContain(id);
  });

  it("treats someone else's post, a missing post and a second delete as not found", async () => {
    const a = await member();
    const b = await member();
    const id = await post(a, "mine");

    expect(await deletePost(db(), b, id)).toEqual({ ok: false, code: "not_found" });
    expect((await row(id)).deletedAt).toBeNull();
    expect(await deletePost(db(), a, newId("post"))).toEqual({ ok: false, code: "not_found" });
    await deletePost(db(), a, id);
    expect(await deletePost(db(), a, id)).toEqual({ ok: false, code: "not_found" });
  });

  it("lowers the parent's reply count when a reply is deleted", async () => {
    const a = await member();
    const parent = await post(a, "parent");
    const r1 = await post(a, "one", parent);
    await post(a, "two", parent);
    expect((await row(parent)).replyCount).toBe(2);

    await deletePost(db(), a, r1);

    expect((await row(parent)).replyCount).toBe(1);
    expect((await listReplies(db(), a, parent)).items).toHaveLength(1);
  });
});

describe("visibility", () => {
  it("hides posts by people who are not active members", async () => {
    const a = await member();
    const waiting = await member("pending");
    const hidden = await post(waiting, "from a pending person");
    const shown = await post(a, "from a member");

    const ids = (await listFeed(db(), a)).items.map((p) => p.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
    expect(await getPost(db(), a, hidden)).toBeNull();
    expect(await setLike(db(), a, hidden, true)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("listFeed", () => {
  it("pages newest first with a cursor and loses nothing, even when posts share a millisecond", async () => {
    const a = await member();
    const same = Date.now() - 50_000;
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = newId("post");
      ids.push(id);
      await db().insert(posts).values({ id, authorId: a, body: `p${i}`, createdAt: new Date(same) });
    }

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await listFeed(db(), a, { cursor, limit: 3 });
      seen.push(...page.items.filter((p) => ids.includes(p.id)).map((p) => p.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 100);

    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
  });

  it("returns no next cursor on the last page", async () => {
    const a = await member();
    await post(a, "only");
    const page = await listFeed(db(), a, { limit: 1000 });
    expect(page.nextCursor).toBeNull();
  });

  it("ignores a forged cursor", async () => {
    const a = await member();
    await post(a, "still here");
    expect((await listFeed(db(), a, { cursor: "garbage'; drop table posts;--" })).items.length).toBeGreaterThan(0);
    expect(decodeCursor("12_post_aaaaaaaaaaaaaaaaaaaaaaaa")).toEqual({ createdAt: 12, id: "post_aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(decodeCursor(encodeCursor(5, newId("post")))).not.toBeNull();
    expect(decodeCursor("5_usr_aaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
});

describe("likes", () => {
  it("likes once however many times it is sent, and unlikes the same way", async () => {
    const a = await member();
    const id = await post(a, "like me");

    expect(await setLike(db(), a, id, true)).toEqual({ ok: true, liked: true, likeCount: 1 });
    expect(await setLike(db(), a, id, true)).toEqual({ ok: true, liked: true, likeCount: 1 });
    expect((await getPost(db(), a, id))?.likedByMe).toBe(true);

    expect(await setLike(db(), a, id, false)).toEqual({ ok: true, liked: false, likeCount: 0 });
    expect(await setLike(db(), a, id, false)).toEqual({ ok: true, liked: false, likeCount: 0 });
    expect((await getPost(db(), a, id))?.likedByMe).toBe(false);
  });

  it("shows each person only their own like state but everyone the same count", async () => {
    const a = await member();
    const b = await member();
    const id = await post(a, "shared");
    await setLike(db(), b, id, true);

    expect(await getPost(db(), a, id)).toMatchObject({ likedByMe: false, likeCount: 1 });
    expect(await getPost(db(), b, id)).toMatchObject({ likedByMe: true, likeCount: 1 });
  });

  it("counts correctly when many people like at the same moment", async () => {
    const a = await member();
    const id = await post(a, "popular");
    const fans = await Promise.all(Array.from({ length: 10 }, () => member()));
    await Promise.all(fans.map((f) => setLike(db(), f, id, true)));
    await Promise.all(fans.map((f) => setLike(db(), f, id, true)));
    expect((await row(id)).likeCount).toBe(10);
  });

  it("refuses to like a deleted or missing post", async () => {
    const a = await member();
    const id = await post(a, "going");
    await deletePost(db(), a, id);
    expect(await setLike(db(), a, id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setLike(db(), a, newId("post"), true)).toEqual({ ok: false, code: "not_found" });
  });

  it("removes likes with the post's row if the row is ever really deleted", async () => {
    const a = await member();
    const id = await post(a, "temp");
    await setLike(db(), a, id, true);
    await env.DB.prepare("delete from posts where id = ?").bind(id).run();
    const left = await env.DB.prepare("select count(*) as n from likes where post_id = ?").bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("the database itself", () => {
  it("refuses an empty body, an over-long body and a negative counter", async () => {
    const a = await member();
    const bad = (body: string) => env.DB.prepare("insert into posts (id, author_id, body) values (?, ?, ?)").bind(newId("post"), a, body).run();
    await expect(bad("")).rejects.toThrow();
    await expect(bad("x".repeat(281))).rejects.toThrow();
    const id = await post(a, "counted");
    await expect(env.DB.prepare("update posts set like_count = -1 where id = ?").bind(id).run()).rejects.toThrow();
  });
});
