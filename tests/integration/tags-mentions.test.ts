import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { countUnreadAlerts, listAlerts } from "@/server/notifications";
import { createPost, deletePost, getPost, listByAuthor, listFeed } from "@/server/posts";
import { setBlock, setPrivate } from "@/server/privacy";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `tm${i}@example.com` });
  const username = `tm_${i}`;
  await db().insert(profiles).values({ userId: id, username, firstName: `Tess${i}`, lastName: "Tag", status: opts.status ?? "active" });
  return { id, username };
}

const tick = () => new Promise((r) => setTimeout(r, 4));
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const idOf = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;
const say = async (authorId: string, text: string) => idOf(await createPost(db(), authorId, text));
const alerts = async (userId: string) => (await listAlerts(db(), userId)).items;
const tagSearch = async (viewerId: string, q: string) => (await searchPosts(db(), viewerId, q, { limit: 50 })).items.map((p) => p.id);

describe("hashtags", () => {
  it("are kept per post, lower-cased and distinct, and come back with the post", async () => {
    const me = await member();
    const id = await say(me.id, "Morning #Coffee and #coffee, then #Tea_Time and #2024!");
    expect((await getPost(db(), me.id, id))?.tags.sort()).toEqual(["2024", "coffee", "tea_time"]);
    expect(await count("select count(*) as n from post_tags where post_id = ?", id)).toBe(3);
    // A post with no # has none, and costs nothing to read.
    expect((await getPost(db(), me.id, await say(me.id, "no tags here")))?.tags).toEqual([]);
  });

  it("keep the first 10 and leave the rest as plain text", async () => {
    const me = await member();
    const text = Array.from({ length: 13 }, (_, i) => `#t${i}`).join(" ");
    const id = await say(me.id, text);
    const post = await getPost(db(), me.id, id);
    expect(post?.tags).toHaveLength(10);
    expect(post?.tags).not.toContain("t10");
    expect(post?.body).toBe(text);
  });

  it("are not made from a web address, the middle of a word, or text that is not a tag", async () => {
    const me = await member();
    const id = await say(me.id, "see https://example.com/page#section, C# and me@example.com and # alone");
    expect((await getPost(db(), me.id, id))?.tags).toEqual([]);
  });

  it("are found by an exact search, in either case, newest first, and not by a prefix or a plain word", async () => {
    const me = await member();
    const a = await say(me.id, "first #sunrise");
    await tick();
    const b = await say(me.id, "second #SunRise");
    await say(me.id, "a #sunrisewalk is another tag");
    await say(me.id, "sunrise without a hash");
    expect(await tagSearch(me.id, "#sunrise")).toEqual([b, a]);
    expect(await tagSearch(me.id, "#SUNRISE")).toEqual([b, a]);
    expect(await tagSearch(me.id, "#sunris")).toEqual([]);
  });

  it("can be one character, and a hash with other words is an ordinary search", async () => {
    const me = await member();
    const id = await say(me.id, "tiny #x tag");
    expect(await tagSearch(me.id, "#x")).toEqual([id]);
    // Not a lone tag, so it is a text search for the words (the # is dropped).
    expect(await tagSearch(me.id, "#x tiny")).toEqual([id]);
    expect(await tagSearch(me.id, "#")).toEqual([]);
  });

  it("include replies, and page without repeats", async () => {
    const me = await member();
    const parent = await say(me.id, "a question");
    const reply = idOf(await createPost(db(), me.id, "an answer #paged", parent));
    const ids = [reply];
    for (let i = 0; i < 4; i++) {
      await tick();
      ids.unshift(await say(me.id, `post ${i} #paged`));
    }
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 6; guard++) {
      const page = await searchPosts(db(), me.id, "#paged", { limit: 2, cursor });
      walked.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(walked.sort()).toEqual([...ids].sort());
  });

  it("follow the one visibility rule: hidden when the post is deleted, private or blocked", async () => {
    const author = await member();
    const reader = await member();
    const id = await say(author.id, "visible for now #rule");
    expect(await tagSearch(reader.id, "#rule")).toEqual([id]);
    await setPrivate(db(), author.id, true);
    expect(await tagSearch(reader.id, "#rule")).toEqual([]);
    expect(await tagSearch(author.id, "#rule")).toEqual([id]);
    await setPrivate(db(), author.id, false);
    await setBlock(db(), reader.id, author.id, true);
    expect(await tagSearch(reader.id, "#rule")).toEqual([]);
    await setBlock(db(), reader.id, author.id, false);
    await deletePost(db(), author.id, id);
    expect(await tagSearch(reader.id, "#rule")).toEqual([]);
  });

  it("show on the feed and profile with the tags attached", async () => {
    const me = await member();
    const id = await say(me.id, "everywhere #here");
    expect((await listFeed(db(), me.id, { scope: "all", limit: 50 })).items.find((p) => p.id === id)?.tags).toEqual(["here"]);
    expect((await listByAuthor(db(), me.id, me.id)).items[0]?.tags).toEqual(["here"]);
  });
});

describe("mentions", () => {
  it("alert the person once, link only people who exist, and come back with the post", async () => {
    const me = await member();
    const pal = await member();
    const id = await say(me.id, `hi @${pal.username}, again @${pal.username.toUpperCase()}, and @nobodyhere`);
    const post = await getPost(db(), me.id, id);
    expect(post?.mentions).toEqual([pal.username]);

    const got = await alerts(pal.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "mention", count: 1, post: { id } });
    expect(await countUnreadAlerts(db(), pal.id)).toBe(1);
  });

  it("make no alert for yourself, but your own name is still a link", async () => {
    const me = await member();
    const id = await say(me.id, `note to @${me.username}`);
    expect((await getPost(db(), me.id, id))?.mentions).toEqual([me.username]);
    expect(await count("select count(*) as n from notifications where recipient_id = ?", me.id)).toBe(0);
  });

  it("skip people who are not active members, and people with a block either way", async () => {
    const me = await member();
    const waiting = await member({ status: "pending" });
    const iBlocked = await member();
    const blockedMe = await member();
    await setBlock(db(), me.id, iBlocked.id, true);
    await setBlock(db(), blockedMe.id, me.id, true);
    const id = await say(me.id, `@${waiting.username} @${iBlocked.username} @${blockedMe.username}`);
    expect((await getPost(db(), me.id, id))?.mentions).toEqual([]);
    for (const who of [waiting, iBlocked, blockedMe]) expect(await count("select count(*) as n from notifications where recipient_id = ?", who.id)).toBe(0);
  });

  it("tell the author of a reply's parent only through the reply alert", async () => {
    const author = await member();
    const replier = await member();
    const third = await member();
    const parent = await say(author.id, "a question");
    const reply = idOf(await createPost(db(), replier.id, `@${author.username} and @${third.username}`, parent));
    expect((await alerts(author.id)).map((a) => a.type)).toEqual(["reply"]);
    expect((await alerts(third.id)).map((a) => a.type)).toEqual(["mention"]);
    // Both are still drawn as links.
    expect((await getPost(db(), replier.id, reply))?.mentions.sort()).toEqual([author.username, third.username].sort());
  });

  it("tell the author of a quoted post only through the quote alert", async () => {
    const author = await member();
    const quoter = await member();
    const third = await member();
    const original = await say(author.id, "quote me");
    await createPost(db(), quoter.id, `@${author.username} @${third.username} agreed`, undefined, [], undefined, undefined, original);
    expect((await alerts(author.id)).map((a) => a.type)).toEqual(["quote"]);
    expect((await alerts(third.id)).map((a) => a.type)).toEqual(["mention"]);
  });

  it("alert at most 10 distinct people for one post", async () => {
    const me = await member();
    const people = [];
    for (let i = 0; i < 12; i++) people.push(await member());
    const id = await say(me.id, people.map((p) => `@${p.username}`).join(" "));
    expect((await getPost(db(), me.id, id))?.mentions).toHaveLength(10);
    expect(await count("select count(*) as n from notifications where type = 'mention' and post_id = ?", id)).toBe(10);
    expect(await count("select count(*) as n from notifications where type = 'mention' and recipient_id = ?", people[11]!.id)).toBe(0);
  });

  it("are not alerts for a reader who cannot see the post", async () => {
    const priv = await member();
    const stranger = await member();
    await setPrivate(db(), priv.id, true);
    await say(priv.id, `psst @${stranger.username}`);
    expect(await alerts(stranger.id)).toEqual([]);
    expect(await countUnreadAlerts(db(), stranger.id)).toBe(0);
  });

  it("go when the post is deleted", async () => {
    const me = await member();
    const pal = await member();
    const id = await say(me.id, `bye @${pal.username}`);
    expect(await alerts(pal.id)).toHaveLength(1);
    await deletePost(db(), me.id, id);
    expect(await alerts(pal.id)).toEqual([]);
  });

  it("are not made from an email address, a web address or a name that is too short", async () => {
    const me = await member();
    const pal = await member();
    const id = await say(me.id, `mail x@${pal.username}.com or https://site.org/@${pal.username} or @ab`);
    expect((await getPost(db(), me.id, id))?.mentions).toEqual([]);
  });
});

describe("the database checks", () => {
  it("refuses an empty tag and one over 50 characters, and a tag twice on a post", async () => {
    const me = await member();
    const id = await say(me.id, "a post");
    const put = (tag: string) => env.DB.prepare("insert into post_tags (post_id, tag, created_at) values (?, ?, 1)").bind(id, tag).run();
    await put("a");
    await put("a".repeat(50));
    await expect(put("")).rejects.toThrow();
    await expect(put("a".repeat(51))).rejects.toThrow();
    await expect(put("a")).rejects.toThrow();
  });

  it("removes tags and mentions with the post", async () => {
    const me = await member();
    const pal = await member();
    const id = await say(me.id, `#gone @${pal.username}`);
    expect(await count("select count(*) as n from post_tags where post_id = ?", id)).toBe(1);
    expect(await count("select count(*) as n from post_mentions where post_id = ?", id)).toBe(1);
    await env.DB.prepare("delete from posts where id = ?").bind(id).run();
    expect(await count("select count(*) as n from post_tags where post_id = ?", id)).toBe(0);
    expect(await count("select count(*) as n from post_mentions where post_id = ?", id)).toBe(0);
  });
});
