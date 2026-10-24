import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { instance, profiles, user } from "@/db/schema";
import { readInstance } from "@/instance/settings";
import { newId, randomId } from "@/lib/ids";
import type { LinkCard } from "@/links/fetch";
import { setLinkPreviewsEnabled } from "@/server/admin";
import { createPost, deletePost, getPost, listByAuthor, listFeed, listReplies } from "@/server/posts";
import { LIMITS, limitLinkPreview } from "@/server/rate-limit";
import { setPrivate } from "@/server/privacy";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `pl${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `pl_${i}`, firstName: `Lin${i}`, lastName: "Link" });
  return { id, username: `pl_${i}` };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const idOf = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;
const URL1 = "https://news.example.com/story";
const card = (over: Partial<LinkCard> = {}): LinkCard => ({
  url: URL1,
  title: "A headline",
  description: "About the story.",
  image: "https://cdn.example.com/p.png",
  site: "Example News",
  ...over,
});
const withCard = (authorId: string, text: string, c: unknown, parent?: string) => createPost(db(), authorId, text, parent, [], undefined, undefined, undefined, c);

describe("a post with a link card", () => {
  it("keeps the card and shows it wherever the post is", async () => {
    const author = await member();
    const reader = await member();
    const id = idOf(await withCard(author.id, `read this ${URL1} it is good`, card()));
    expect((await getPost(db(), reader.id, id))?.link).toEqual(card());
    expect((await listFeed(db(), reader.id, { scope: "all", limit: 50 })).items.find((p) => p.id === id)?.link).toEqual(card());
    expect((await listByAuthor(db(), reader.id, author.id)).items[0]?.link).toEqual(card());
    expect((await searchPosts(db(), reader.id, "good")).items[0]?.link).toEqual(card());
    expect(await count("select count(*) as n from post_links where post_id = ?", id)).toBe(1);
  });

  it("works on a reply and on a card with no picture or description", async () => {
    const author = await member();
    const parent = idOf(await createPost(db(), author.id, "a question"));
    const plain = card({ image: null, description: "" });
    const reply = idOf(await withCard(author.id, `see ${URL1}`, plain, parent));
    expect((await listReplies(db(), author.id, parent)).items.find((p) => p.id === reply)?.link).toEqual(plain);
  });

  it("is null on a post without one, even if its text has a web address", async () => {
    const author = await member();
    const id = idOf(await createPost(db(), author.id, `just words and ${URL1}`));
    expect((await getPost(db(), author.id, id))?.link).toBeNull();
    expect((await getPost(db(), author.id, idOf(await createPost(db(), author.id, "no link at all"))))?.link).toBeNull();
  });

  it("goes with the card of the first address only", async () => {
    const author = await member();
    const second = "https://other.example.com/page";
    expect(await withCard(author.id, `${second} and ${URL1}`, card())).toEqual({ ok: false, code: "bad_link" });
    const id = idOf(await withCard(author.id, `${URL1} and ${second}`, card()));
    expect((await getPost(db(), author.id, id))?.link?.url).toBe(URL1);
  });

  it("is refused when the address is not in the words, or the post has pictures, a GIF or a quote, and writes nothing", async () => {
    const author = await member();
    const other = await member();
    const original = idOf(await createPost(db(), other.id, "quote me"));
    const photo = `posts/${author.id}/${randomId(24)}.png`;
    const gif = { url: "https://static.klipy.com/a/b.webp", width: 10, height: 10 };
    expect(await withCard(author.id, "no address here", card())).toEqual({ ok: false, code: "bad_link" });
    // Blank words with a card are not a post at all (a card is not a reason to post).
    expect(await withCard(author.id, "   ", card())).toEqual({ ok: false, code: "empty" });
    expect(await createPost(db(), author.id, `${URL1}`, undefined, [photo], undefined, undefined, undefined, card())).toEqual({ ok: false, code: "bad_link" });
    expect(await createPost(db(), author.id, `${URL1}`, undefined, [], undefined, gif, undefined, card())).toEqual({ ok: false, code: "bad_link" });
    expect(await createPost(db(), author.id, `${URL1}`, undefined, [], undefined, undefined, original, card())).toEqual({ ok: false, code: "bad_link" });
    expect(await count("select count(*) as n from posts where author_id = ?", author.id)).toBe(0);
  });

  it.each([
    ["no title", { title: "" }],
    ["a long title", { title: "t".repeat(151) }],
    ["a long description", { description: "d".repeat(301) }],
    ["no site", { site: "" }],
    ["a long site", { site: "s".repeat(61) }],
    ["a picture that is not https", { image: "http://cdn.example.com/p.png" }],
    ["a picture on a private address", { image: "https://127.0.0.1/p.png" }],
    ["a picture that is a script", { image: "javascript:alert(1)" }],
    ["a long picture address", { image: `https://cdn.example.com/${"a".repeat(500)}` }],
    ["text with a line break", { title: "two\nlines" }],
    ["text with a control character", { description: "a\u0000b" }],
    ["text with spaces to trim", { title: " padded " }],
    ["an address the post would not link", { url: "ftp://news.example.com/story" }],
    ["an address that is not as normalised", { url: "https://NEWS.example.com" }],
    ["a login in the address", { url: "https://u:p@news.example.com/story" }],
  ] as [string, Partial<ReturnType<typeof card>>][])("is refused for %s, and writes nothing", async (_name, over) => {
    const author = await member();
    const bad = { ...card(), ...over };
    const text = typeof over.url === "string" ? over.url : URL1;
    expect(await withCard(author.id, `read ${text}`, bad)).toEqual({ ok: false, code: "bad_link" });
    expect(await count("select count(*) as n from posts where author_id = ?", author.id)).toBe(0);
  });

  it.each([["a string", "https://x.example.com"], ["a list", [card()]], ["a number", 5], ["missing fields", { url: URL1 }]])("is refused when the card is %s", async (_name, junk) => {
    const author = await member();
    expect(await withCard(author.id, `read ${URL1}`, junk)).toEqual({ ok: false, code: "bad_link" });
  });

  it("follows the one visibility rule: a private account's card is for its followers, and a deleted post's is gone", async () => {
    const author = await member();
    const stranger = await member();
    const id = idOf(await withCard(author.id, `read ${URL1}`, card()));
    expect((await getPost(db(), stranger.id, id))?.link).toEqual(card());
    await setPrivate(db(), author.id, true);
    expect(await getPost(db(), stranger.id, id)).toBeNull();
    expect((await getPost(db(), author.id, id))?.link).toEqual(card());
    await setPrivate(db(), author.id, false);
    await deletePost(db(), author.id, id);
    expect(await getPost(db(), stranger.id, id)).toBeNull();
  });

  it("is removed with the post", async () => {
    const author = await member();
    const id = idOf(await withCard(author.id, `read ${URL1}`, card()));
    await env.DB.prepare("delete from posts where id = ?").bind(id).run();
    expect(await count("select count(*) as n from post_links where post_id = ?", id)).toBe(0);
  });
});

describe("the database checks on a card", () => {
  async function insertPost() {
    const author = await member();
    const id = newId("post");
    await env.DB.prepare("insert into posts (id, author_id, body) values (?, ?, 'x')").bind(id, author.id).run();
    return id;
  }
  const put = (id: string, v: { url?: string; title?: string; description?: string; image?: string | null; site?: string }) =>
    env.DB.prepare("insert into post_links (post_id, url, title, description, image, site) values (?, ?, ?, ?, ?, ?)")
      .bind(id, v.url ?? URL1, v.title ?? "T", v.description ?? "", v.image === undefined ? null : v.image, v.site ?? "S")
      .run();

  it("takes a plain card and one with every field at its limit", async () => {
    await put(await insertPost(), {});
    await put(await insertPost(), { url: `https://e.com/${"a".repeat(480)}`, title: "t".repeat(150), description: "d".repeat(300), image: `https://c.com/${"a".repeat(480)}`, site: "s".repeat(60) });
    await put(await insertPost(), { url: "http://plain.example.com/" });
  });

  it("refuses an odd address, an empty or long title, a long description, a picture that is not https, an empty or long site, and a second card", async () => {
    const id = await insertPost();
    await expect(put(id, { url: "ftp://x.example.com/" })).rejects.toThrow();
    await expect(put(id, { url: `https://e.com/${"a".repeat(500)}` })).rejects.toThrow();
    await expect(put(id, { title: "" })).rejects.toThrow();
    await expect(put(id, { title: "t".repeat(151) })).rejects.toThrow();
    await expect(put(id, { description: "d".repeat(301) })).rejects.toThrow();
    await expect(put(id, { image: "http://c.example.com/p.png" })).rejects.toThrow();
    await expect(put(id, { image: `https://c.com/${"a".repeat(500)}` })).rejects.toThrow();
    await expect(put(id, { site: "" })).rejects.toThrow();
    await expect(put(id, { site: "s".repeat(61) })).rejects.toThrow();
    await put(id, {});
    await expect(put(id, {})).rejects.toThrow();
  });
});

describe("turning link previews on and off", () => {
  async function ensureInstance() {
    await db().insert(instance).values({ id: "singleton", name: "Test", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" }).onConflictDoNothing();
  }

  it("is off by default, follows what the admin chose, and repeating it changes nothing", async () => {
    await ensureInstance();
    await setLinkPreviewsEnabled(db(), false);
    expect((await readInstance(db())).settings.linkPreviewsEnabled).toBe(false);
    expect(await setLinkPreviewsEnabled(db(), true)).toEqual({ ok: true, enabled: true });
    expect(await setLinkPreviewsEnabled(db(), true)).toEqual({ ok: true, enabled: true });
    expect((await readInstance(db())).settings.linkPreviewsEnabled).toBe(true);
    expect(await setLinkPreviewsEnabled(db(), false)).toEqual({ ok: true, enabled: false });
  });

  it.each([["on"], [1], [0], [null], [undefined], [{}]])("refuses %j and keeps the old choice", async (input) => {
    await ensureInstance();
    await setLinkPreviewsEnabled(db(), true);
    expect(await setLinkPreviewsEnabled(db(), input)).toMatchObject({ ok: false });
    expect((await readInstance(db())).settings.linkPreviewsEnabled).toBe(true);
    await setLinkPreviewsEnabled(db(), false);
  });
});

describe("the preview limit", () => {
  it("allows 20 page fetches in 10 minutes per person and then asks to wait, for that person only", async () => {
    const SALT = "test-salt-for-link-previews";
    const T0 = 1_800_000_000_000;
    expect(LIMITS.linkPreviews).toMatchObject({ max: 20, windowMs: 10 * 60_000 });
    for (let i = 0; i < 20; i++) expect(await limitLinkPreview(env.DB, SALT, "usr_one", T0 + i)).toEqual({ ok: true });
    expect(await limitLinkPreview(env.DB, SALT, "usr_one", T0 + 100)).toMatchObject({ ok: false });
    expect(await limitLinkPreview(env.DB, SALT, "usr_two", T0 + 100)).toEqual({ ok: true });
    expect(await limitLinkPreview(env.DB, SALT, "usr_one", T0 + 11 * 60_000)).toEqual({ ok: true });
  });
});
