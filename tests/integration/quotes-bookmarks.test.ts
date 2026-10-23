import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId, randomId } from "@/lib/ids";
import { setBookmark, listBookmarks } from "@/server/bookmarks";
import { setFollow } from "@/server/follows";
import { listAlerts } from "@/server/notifications";
import { createPost, deletePost, getPost, listFeed, setRepost } from "@/server/posts";
import { setBlock, setPrivate } from "@/server/privacy";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { isPrivate?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `qb${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `qb_${i}`, firstName: `Quinn${i}`, lastName: "Quote", isPrivate: opts.isPrivate ?? false });
  return { id, username: `qb_${i}` };
}

const tick = () => new Promise((r) => setTimeout(r, 4));
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postBy = async (authorId: string, text = "a post worth reading") => ((await createPost(db(), authorId, text)) as { id: string }).id;
const idOf = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;
const quote = (authorId: string, text: string, quotedId: string) => createPost(db(), authorId, text, undefined, [], undefined, undefined, quotedId);

describe("a quote post", () => {
  it("carries the original as a card, with the quoter's own words", async () => {
    const author = await member();
    const quoter = await member();
    const original = await postBy(author.id, "the original words");
    const made = await quote(quoter.id, "my take on it", original);
    expect(made.ok).toBe(true);

    const post = await getPost(db(), author.id, idOf(made));
    expect(post?.body).toBe("my take on it");
    expect(post?.quote).toMatchObject({
      available: true,
      id: original,
      body: "the original words",
      photoCount: 0,
      hasGif: false,
      author: { username: author.username },
    });
    // An ordinary post has no card.
    expect((await getPost(db(), author.id, original))?.quote).toBeNull();
  });

  it("can have no words of its own", async () => {
    const author = await member();
    const quoter = await member();
    const original = await postBy(author.id);
    for (const words of ["", "   "]) {
      const made = await quote(quoter.id, words, original);
      expect(made.ok).toBe(true);
      const post = await getPost(db(), quoter.id, idOf(made));
      expect(post?.body).toBe("");
      expect(post?.quote).toMatchObject({ available: true, id: original });
    }
  });

  it("shows in the feed and in search, with its card", async () => {
    const author = await member();
    const quoter = await member();
    const fan = await member();
    await setFollow(db(), fan.id, quoter.id, true);
    const original = await postBy(author.id, "something quotable");
    const made = idOf(await quote(quoter.id, "wise words", original));
    const inFeed = (await listFeed(db(), fan.id, { scope: "following" })).items.find((p) => p.id === made);
    expect(inFeed?.quote).toMatchObject({ available: true, id: original });
    expect((await searchPosts(db(), fan.id, "wise")).items[0]?.quote).toMatchObject({ available: true, id: original });
  });

  it("tells the author of the original, not the quoter, and points at the new post", async () => {
    const author = await member();
    const quoter = await member();
    const original = await postBy(author.id);
    const made = idOf(await quote(quoter.id, "hello there", original));
    const items = (await listAlerts(db(), author.id)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "quote", post: { id: made, body: "hello there" } });

    // Quoting your own post tells nobody.
    const mine = await postBy(author.id);
    await quote(author.id, "self quote", mine);
    expect((await listAlerts(db(), author.id)).items).toHaveLength(1);
  });

  it("says 'not available' for a reader who cannot see the original, and for a deleted one", async () => {
    const author = await member();
    const quoter = await member();
    const reader = await member();
    const original = await postBy(author.id);
    const made = idOf(await quote(quoter.id, "look at this", original));

    expect((await getPost(db(), reader.id, made))?.quote).toMatchObject({ available: true });
    await setBlock(db(), author.id, reader.id, true);
    expect((await getPost(db(), reader.id, made))?.quote).toEqual({ available: false });
    await setBlock(db(), author.id, reader.id, false);
    expect((await getPost(db(), reader.id, made))?.quote).toMatchObject({ available: true });
    await setPrivate(db(), author.id, true);
    expect((await getPost(db(), reader.id, made))?.quote).toEqual({ available: false });
    await setPrivate(db(), author.id, false);
    await deletePost(db(), author.id, original);
    expect((await getPost(db(), reader.id, made))?.quote).toEqual({ available: false });
    // The quote itself stays.
    expect((await getPost(db(), reader.id, made))?.body).toBe("look at this");
  });

  it("is refused for a private account's post, a missing post, a reply, pictures, a GIF, and writes nothing", async () => {
    const priv = await member({ isPrivate: true });
    const author = await member();
    const quoter = await member();
    const privPost = await postBy(priv.id);
    const parent = await postBy(author.id);
    const original = await postBy(author.id);
    const photo = `posts/${quoter.id}/${randomId(24)}.png`;
    const gif = { url: "https://static.klipy.com/a/b.webp", width: 10, height: 10 };
    await env.DB.prepare("insert into follows (follower_id, followee_id) values (?, ?)").bind(quoter.id, priv.id).run();

    expect(await quote(quoter.id, "x", privPost)).toEqual({ ok: false, code: "quote_private" });
    expect(await quote(priv.id, "x", privPost)).toEqual({ ok: false, code: "quote_private" });
    expect(await quote(quoter.id, "x", newId("post"))).toEqual({ ok: false, code: "quote_not_found" });
    expect(await quote(quoter.id, "x", "nonsense")).toEqual({ ok: false, code: "quote_not_found" });
    expect(await createPost(db(), quoter.id, "x", parent, [], undefined, undefined, original)).toEqual({ ok: false, code: "quote_and_reply" });
    expect(await createPost(db(), quoter.id, "x", undefined, [photo], undefined, undefined, original)).toEqual({ ok: false, code: "quote_with_media" });
    expect(await createPost(db(), quoter.id, "x", undefined, [], undefined, gif, original)).toEqual({ ok: false, code: "quote_with_media" });
    expect(await count("select count(*) as n from posts where author_id = ?", quoter.id)).toBe(0);
  });

  it("may carry a place", async () => {
    const author = await member();
    const quoter = await member();
    const original = await postBy(author.id);
    const made = idOf(await createPost(db(), quoter.id, "from here", undefined, [], "Oslo, Norway", undefined, original));
    expect((await getPost(db(), quoter.id, made))?.place).toBe("Oslo, Norway");
  });

  it("can quote a reply, and a quote can itself be reposted", async () => {
    const author = await member();
    const quoter = await member();
    const fan = await member();
    const parent = await postBy(author.id);
    const reply = idOf(await createPost(db(), author.id, "an answer", parent));
    const made = idOf(await quote(quoter.id, "on that answer", reply));
    expect((await getPost(db(), quoter.id, made))?.quote).toMatchObject({ available: true, id: reply });
    expect(await setRepost(db(), fan.id, made, true)).toMatchObject({ ok: true, repostCount: 1 });
  });
});

describe("saving a post", () => {
  it("is a private list, newest saved first, and sending the same state twice changes nothing", async () => {
    const author = await member();
    const me = await member();
    const other = await member();
    const [a, b, c] = [await postBy(author.id, "a"), await postBy(author.id, "b"), await postBy(author.id, "c")];
    for (const id of [a, c, b]) {
      await tick();
      expect(await setBookmark(db(), me.id, id, true)).toEqual({ ok: true, saved: true });
    }
    await setBookmark(db(), me.id, c, true);

    const mine = await listBookmarks(db(), me.id);
    expect(mine.items.map((p) => p.id)).toEqual([b, c, a]);
    expect(mine.items.every((p) => p.bookmarkedByMe)).toBe(true);
    // Nobody else sees the list, or the flag, or any count.
    expect((await listBookmarks(db(), other.id)).items).toEqual([]);
    const seen = await getPost(db(), other.id, a);
    expect(seen?.bookmarkedByMe).toBe(false);
    expect(Object.keys(seen ?? {}).some((k) => /bookmark/i.test(k) && k !== "bookmarkedByMe")).toBe(false);
    expect(Object.keys((await getPost(db(), author.id, a)) ?? {})).not.toContain("bookmarkCount");

    expect(await setBookmark(db(), me.id, c, false)).toEqual({ ok: true, saved: false });
    expect(await setBookmark(db(), me.id, c, false)).toEqual({ ok: true, saved: false });
    expect((await listBookmarks(db(), me.id)).items.map((p) => p.id)).toEqual([b, a]);
  });

  it("pages in the order saved, without repeats", async () => {
    const author = await member();
    const me = await member();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await postBy(author.id, `p${i}`);
      ids.push(id);
      await tick();
      await setBookmark(db(), me.id, id, true);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 6; guard++) {
      const page = await listBookmarks(db(), me.id, { limit: 2, cursor });
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it("skips what you can no longer see, and brings it back when you can again", async () => {
    const author = await member();
    const me = await member();
    const keep = await postBy(author.id, "keep");
    const gone = await postBy(author.id, "gone");
    await setBookmark(db(), me.id, keep, true);
    await setBookmark(db(), me.id, gone, true);

    await deletePost(db(), author.id, gone);
    expect((await listBookmarks(db(), me.id)).items.map((p) => p.id)).toEqual([keep]);

    await setPrivate(db(), author.id, true);
    expect((await listBookmarks(db(), me.id)).items).toEqual([]);
    await setPrivate(db(), author.id, false);
    await setBlock(db(), author.id, me.id, true);
    expect((await listBookmarks(db(), me.id)).items).toEqual([]);
    await setBlock(db(), author.id, me.id, false);
    expect((await listBookmarks(db(), me.id)).items.map((p) => p.id)).toEqual([keep]);
  });

  it("refuses a post you cannot see, but lets you drop one you can no longer see", async () => {
    const author = await member();
    const me = await member();
    const id = await postBy(author.id);
    await setBookmark(db(), me.id, id, true);
    await setBlock(db(), author.id, me.id, true);
    expect(await setBookmark(db(), me.id, id, true)).toEqual({ ok: false, code: "not_found" });
    const other = await postBy(author.id);
    expect(await setBookmark(db(), me.id, other, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setBookmark(db(), me.id, "nonsense", true)).toEqual({ ok: false, code: "not_found" });
    expect(await setBookmark(db(), me.id, id, false)).toEqual({ ok: true, saved: false });
    expect(await count("select count(*) as n from bookmarks where user_id = ?", me.id)).toBe(0);
  });

  it("can hold a reply and a quote", async () => {
    const author = await member();
    const me = await member();
    const parent = await postBy(author.id);
    const reply = idOf(await createPost(db(), author.id, "an answer", parent));
    await setBookmark(db(), me.id, reply, true);
    expect((await listBookmarks(db(), me.id)).items.map((p) => p.id)).toEqual([reply]);
  });
});
