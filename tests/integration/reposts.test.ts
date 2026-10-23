import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setFollow } from "@/server/follows";
import { listAlerts } from "@/server/notifications";
import { createPost, deletePost, getPost, listByAuthor, listFeed, listReplies, setRepost, type PostView } from "@/server/posts";
import { setBlock, setMute, setPrivate } from "@/server/privacy";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { isPrivate?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `rp${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `rp_${i}`, firstName: `Rae${i}`, lastName: "Repost", isPrivate: opts.isPrivate ?? false });
  return { id, username: `rp_${i}` };
}

// Posts and reposts are ordered by millisecond, so tests wait a moment between steps that must be in order.
const tick = () => new Promise((r) => setTimeout(r, 4));
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postBy = async (authorId: string, text = "a post worth reading") => ((await createPost(db(), authorId, text)) as { id: string }).id;
const follow = (a: { id: string }, b: { id: string }) => setFollow(db(), a.id, b.id, true);
const feed = async (viewer: { id: string }, scope: "following" | "all" = "following") => (await listFeed(db(), viewer.id, { scope, limit: 50 })).items;
const shape = (items: PostView[]) => items.map((p) => `${p.id}${p.repostedBy ? `<-${p.repostedBy.username}` : ""}`);

describe("reposting", () => {
  it("is saved with a counter on the post, and sending the same state twice changes nothing", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);

    expect(await setRepost(db(), fan.id, id, true)).toEqual({ ok: true, reposted: true, repostCount: 1 });
    expect(await setRepost(db(), fan.id, id, true)).toEqual({ ok: true, reposted: true, repostCount: 1 });
    const seen = await getPost(db(), fan.id, id);
    expect(seen?.repostCount).toBe(1);
    expect(seen?.repostedByMe).toBe(true);
    expect((await getPost(db(), author.id, id))?.repostedByMe).toBe(false);

    expect(await setRepost(db(), fan.id, id, false)).toEqual({ ok: true, reposted: false, repostCount: 0 });
    expect(await setRepost(db(), fan.id, id, false)).toEqual({ ok: true, reposted: false, repostCount: 0 });
    expect(await count("select count(*) as n from reposts where post_id = ?", id)).toBe(0);
  });

  it("counts every person once", async () => {
    const author = await member();
    const [a, b, c] = [await member(), await member(), await member()];
    const id = await postBy(author.id);
    for (const who of [a, b, c, a]) await setRepost(db(), who.id, id, true);
    expect((await getPost(db(), author.id, id))?.repostCount).toBe(3);
    await setRepost(db(), b.id, id, false);
    expect((await getPost(db(), author.id, id))?.repostCount).toBe(2);
  });

  it("can be done to your own post, which tells nobody", async () => {
    const me = await member();
    const id = await postBy(me.id);
    expect(await setRepost(db(), me.id, id, true)).toMatchObject({ ok: true, repostCount: 1 });
    expect(await count("select count(*) as n from notifications where recipient_id = ?", me.id)).toBe(0);
  });

  it("refuses a post that is private, a reply, hidden from you or not there, and writes nothing", async () => {
    const author = await member();
    const priv = await member({ isPrivate: true });
    const blocked = await member();
    const fan = await member();
    const privPost = await postBy(priv.id);
    const parent = await postBy(author.id);
    const reply = ((await createPost(db(), author.id, "an answer", parent)) as { id: string }).id;
    const hidden = await postBy(author.id);
    await setBlock(db(), author.id, blocked.id, true);

    // Even a follower of a private account cannot repost it, and neither can its owner.
    // Following a private account only sends a request, so the follow is written directly (as if approved).
    await env.DB.prepare("insert into follows (follower_id, followee_id) values (?, ?)").bind(fan.id, priv.id).run();
    expect(await setRepost(db(), fan.id, privPost, true)).toEqual({ ok: false, code: "private" });
    expect(await setRepost(db(), priv.id, privPost, true)).toEqual({ ok: false, code: "private" });
    expect(await setRepost(db(), fan.id, reply, true)).toEqual({ ok: false, code: "reply" });
    expect(await setRepost(db(), blocked.id, hidden, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setRepost(db(), fan.id, newId("post"), true)).toEqual({ ok: false, code: "not_found" });
    expect(await setRepost(db(), fan.id, "not an id", true)).toEqual({ ok: false, code: "not_found" });
    expect(await count("select count(*) as n from reposts where post_id in (?, ?, ?)", privPost, reply, hidden)).toBe(0);
  });

  it("can always be taken back, even after the post became hidden from you", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);
    await setRepost(db(), fan.id, id, true);
    await setBlock(db(), author.id, fan.id, true);
    expect(await getPost(db(), fan.id, id)).toBeNull();
    expect(await setRepost(db(), fan.id, id, false)).toMatchObject({ ok: true, reposted: false });
    expect(await count("select count(*) as n from reposts where post_id = ?", id)).toBe(0);
  });
});

describe("the alert for a repost", () => {
  it("goes to the author, collapses with others, and is taken back with the repost", async () => {
    const author = await member();
    const [a, b] = [await member(), await member()];
    const id = await postBy(author.id, "worth sharing");
    await setRepost(db(), a.id, id, true);
    await tick();
    await setRepost(db(), b.id, id, true);

    const items = (await listAlerts(db(), author.id)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "repost", count: 2, post: { id, body: "worth sharing" } });

    await setRepost(db(), a.id, id, false);
    await setRepost(db(), b.id, id, false);
    expect((await listAlerts(db(), author.id)).items).toHaveLength(0);
  });

  it("is not made twice by a double tap", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);
    await setRepost(db(), fan.id, id, true);
    await setRepost(db(), fan.id, id, true);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'repost'", author.id)).toBe(1);
  });
});

describe("reposts in the feed", () => {
  it("show to followers of the person who reposted, above the original author's post", async () => {
    const author = await member();
    const sharer = await member();
    const follower = await member();
    const stranger = await member();
    await follow(follower, sharer);
    const id = await postBy(author.id);
    await tick();
    await setRepost(db(), sharer.id, id, true);

    // The follower does not follow the author, yet sees the post, marked as the sharer's repost.
    const mine = await feed(follower);
    expect(shape(mine)).toEqual([`${id}<-${sharer.username}`]);
    expect(mine[0]?.repostedBy).toMatchObject({ userId: sharer.id, firstName: expect.any(String) });
    expect(mine[0]?.repostCount).toBe(1);

    // Someone who follows neither does not, in the Following feed; the all-posts list has the post itself.
    expect(await feed(stranger)).toEqual([]);
    expect(shape(await feed(stranger, "all"))).toContain(`${id}<-${sharer.username}`);
  });

  it("show your own reposts to you, and the post twice when you follow both people", async () => {
    const author = await member();
    const sharer = await member();
    const me = await member();
    await follow(me, author);
    await follow(me, sharer);
    const id = await postBy(author.id);
    await tick();
    await setRepost(db(), sharer.id, id, true);
    await tick();
    await setRepost(db(), me.id, id, true);

    // Newest first: my own repost, then the sharer's would be a repeat (dropped), then the post itself.
    expect(shape(await feed(me))).toEqual([`${id}<-${(await getUsername(me.id))}`, id]);
  });

  it("show a post once however many followed people reposted it", async () => {
    const author = await member();
    const [a, b, c] = [await member(), await member(), await member()];
    const me = await member();
    for (const p of [a, b, c]) await follow(me, p);
    const id = await postBy(author.id);
    for (const p of [a, b, c]) {
      await tick();
      await setRepost(db(), p.id, id, true);
    }
    expect(shape(await feed(me))).toEqual([`${id}<-${c.username}`]);
  });

  it("leave out people you muted, and posts by people you muted", async () => {
    const author = await member();
    const sharer = await member();
    const me = await member();
    await follow(me, sharer);
    const id = await postBy(author.id);
    await setRepost(db(), sharer.id, id, true);
    expect(await feed(me)).toHaveLength(1);

    await setMute(db(), me.id, sharer.id, true);
    expect(await feed(me)).toEqual([]);
    await setMute(db(), me.id, sharer.id, false);
    expect(await feed(me)).toHaveLength(1);
    await setMute(db(), me.id, author.id, true);
    expect(await feed(me)).toEqual([]);
  });

  it("disappear when the original is deleted, the author goes private or either person blocks", async () => {
    const author = await member();
    const sharer = await member();
    const me = await member();
    await follow(me, sharer);

    const gone = await postBy(author.id);
    await setRepost(db(), sharer.id, gone, true);
    await deletePost(db(), author.id, gone);
    expect(await feed(me)).toEqual([]);

    const later = await postBy(author.id);
    await setRepost(db(), sharer.id, later, true);
    expect(await feed(me)).toHaveLength(1);
    await setPrivate(db(), author.id, true);
    expect(await feed(me)).toEqual([]);
    await setPrivate(db(), author.id, false);
    expect(await feed(me)).toHaveLength(1);
    await setBlock(db(), me.id, author.id, true);
    expect(await feed(me)).toEqual([]);
  });

  it("walk page by page without losing or repeating anything, mixing posts and reposts", async () => {
    const author = await member();
    const sharer = await member();
    const me = await member();
    await follow(me, author);
    await follow(me, sharer);
    const expected: string[] = [];
    for (let i = 0; i < 6; i++) {
      await tick();
      const id = await postBy(author.id, `walk ${i}`);
      expected.push(id);
      if (i % 2 === 0) {
        await tick();
        await setRepost(db(), sharer.id, id, true);
        expected.push(`${id}<-${sharer.username}`);
      }
    }
    expect(expected).toHaveLength(9);

    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listFeed(db(), me.id, { scope: "following", limit: 2, cursor: cursor ?? undefined });
      walked.push(...shape(page.items));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(walked.sort()).toEqual([...expected].sort());
    expect(new Set(walked).size).toBe(walked.length);
  });
});

describe("a profile", () => {
  it("lists what the person reposted among their posts, but not on the Replies tab", async () => {
    const author = await member();
    const sharer = await member();
    const reader = await member();
    const mine = await postBy(sharer.id, "my own");
    await tick();
    const theirs = await postBy(author.id, "someone else's");
    await tick();
    await setRepost(db(), sharer.id, theirs, true);

    expect(shape((await listByAuthor(db(), reader.id, sharer.id)).items)).toEqual([`${theirs}<-${sharer.username}`, mine]);
    expect((await listByAuthor(db(), reader.id, sharer.id, { replies: true })).items).toEqual([]);
    // The author's own page shows only the author's post.
    expect(shape((await listByAuthor(db(), reader.id, author.id)).items)).toEqual([theirs]);
  });

  it("still shows a muted person's reposts when you open their page on purpose", async () => {
    const author = await member();
    const sharer = await member();
    const reader = await member();
    const theirs = await postBy(author.id);
    await setRepost(db(), sharer.id, theirs, true);
    await setMute(db(), reader.id, sharer.id, true);
    expect((await listByAuthor(db(), reader.id, sharer.id)).items).toHaveLength(1);
  });

  it("hides the reposts of a private account from people who do not follow it", async () => {
    const author = await member();
    const sharer = await member();
    const stranger = await member();
    const theirs = await postBy(author.id);
    await setRepost(db(), sharer.id, theirs, true);
    await setPrivate(db(), sharer.id, true);
    expect((await listByAuthor(db(), stranger.id, sharer.id)).items).toEqual([]);
  });
});

describe("the post page and search keep their shape", () => {
  it("never marks an ordinary post as reposted by someone", async () => {
    const author = await member();
    const id = await postBy(author.id, "findable text");
    expect((await getPost(db(), author.id, id))?.repostedBy).toBeNull();
    expect((await searchPosts(db(), author.id, "findable")).items[0]?.repostedBy).toBeNull();
    expect((await listReplies(db(), author.id, id)).items).toEqual([]);
  });
});

describe("the database checks", () => {
  it("refuses a negative repost count, and a post that is both a reply and a quote", async () => {
    const author = await member();
    const a = await postBy(author.id);
    const b = await postBy(author.id);
    await expect(env.DB.prepare("update posts set repost_count = -1 where id = ?").bind(a).run()).rejects.toThrow();
    await expect(
      env.DB.prepare("insert into posts (id, author_id, body, parent_id, quoted_post_id) values (?, ?, 'x', ?, ?)").bind(newId("post"), author.id, a, b).run(),
    ).rejects.toThrow();
  });

  it("keeps one repost per person per post", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);
    await env.DB.prepare("insert into reposts (user_id, post_id) values (?, ?)").bind(fan.id, id).run();
    await expect(env.DB.prepare("insert into reposts (user_id, post_id) values (?, ?)").bind(fan.id, id).run()).rejects.toThrow();
  });

  it("removes a person's reposts and bookmarks with their account", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);
    await setRepost(db(), fan.id, id, true);
    await env.DB.prepare("insert into bookmarks (user_id, post_id) values (?, ?)").bind(fan.id, id).run();
    await env.DB.prepare("delete from user where id = ?").bind(fan.id).run();
    expect(await count("select count(*) as n from reposts where post_id = ?", id)).toBe(0);
    expect(await count("select count(*) as n from bookmarks where post_id = ?", id)).toBe(0);
  });
});

async function getUsername(userId: string): Promise<string> {
  return (await env.DB.prepare("select username as n from profiles where user_id = ?").bind(userId).first<{ n: string }>())!.n;
}
