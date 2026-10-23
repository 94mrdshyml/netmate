import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { instance, instanceSecrets, profiles, user } from "@/db/schema";
import { randomId, newId } from "@/lib/ids";
import { decryptSecret } from "@/lib/secrets";
import { gifPanel, readKlipyKey, removeKlipyKey, saveKlipyKey } from "@/server/gifs";
import { createPost, deletePost, getPost, listByAuthor, listFeed, listReplies } from "@/server/posts";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);
const ENC = env.SETTINGS_ENCRYPTION_KEY!;

let n = 0;
async function member(opts: { isPrivate?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `gif${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `gif_${i}`, firstName: `Gil${i}`, lastName: "Gif", isPrivate: opts.isPrivate ?? false });
  return id;
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postId = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;
const GIF = { url: "https://static.klipy.com/ii/abc/md.webp", width: 320, height: 240, title: "happy dance" };

describe("a post with a GIF", () => {
  it("keeps only Klipy's address, size and title, and shows the GIF wherever the post is", async () => {
    const author = await member();
    const reader = await member();
    const id = postId(await createPost(db(), author, "so happy", undefined, [], undefined, GIF));

    expect((await getPost(db(), reader, id))?.gif).toEqual(GIF);
    expect((await listFeed(db(), reader, { scope: "all" })).items.find((p) => p.id === id)?.gif).toEqual(GIF);
    expect((await listByAuthor(db(), reader, author)).items[0]?.gif).toEqual(GIF);
    expect((await searchPosts(db(), reader, "happy")).items[0]?.gif).toEqual(GIF);
    expect(await count("select count(*) as n from post_gifs where post_id = ?", id)).toBe(1);
  });

  it("is null on a post without one", async () => {
    const author = await member();
    const id = postId(await createPost(db(), author, "plain"));
    expect((await getPost(db(), author, id))?.gif).toBeNull();
  });

  it("can stand alone with no words, and shows no text", async () => {
    const author = await member();
    const id = postId(await createPost(db(), author, "   ", undefined, [], undefined, GIF));
    const post = await getPost(db(), author, id);
    expect(post?.body).toBe("");
    expect(post?.gif).toEqual(GIF);
  });

  it("works on a reply too", async () => {
    const author = await member();
    const parent = postId(await createPost(db(), author, "a question"));
    const reply = postId(await createPost(db(), author, "", parent, [], undefined, GIF));
    expect((await listReplies(db(), author, parent)).items.find((p) => p.id === reply)?.gif).toEqual(GIF);
  });

  it("goes with a place", async () => {
    const author = await member();
    const id = postId(await createPost(db(), author, "out and about", undefined, [], "Oslo, Norway", GIF));
    const post = await getPost(db(), author, id);
    expect(post?.gif).toEqual(GIF);
    expect(post?.place).toBe("Oslo, Norway");
  });

  it("is refused together with photos, and nothing is written", async () => {
    const author = await member();
    const before = await count("select count(*) as n from posts where author_id = ?", author);
    const photo = `posts/${author}/${randomId(24)}.png`;
    expect(await createPost(db(), author, "both", undefined, [photo], undefined, GIF)).toEqual({ ok: false, code: "gif_with_photos" });
    expect(await count("select count(*) as n from posts where author_id = ?", author)).toBe(before);
  });

  it.each([
    ["another site", { ...GIF, url: "https://example.com/a.gif" }],
    ["a lookalike host", { ...GIF, url: "https://static.klipy.com.evil.com/a.gif" }],
    ["plain http", { ...GIF, url: "http://static.klipy.com/a.gif" }],
    ["a script address", { ...GIF, url: "javascript:alert(1)" }],
    ["a bad size", { ...GIF, width: 0 }],
    ["text", "https://static.klipy.com/a.gif"],
  ])("is refused for %s, and nothing is written", async (_name, gif) => {
    const author = await member();
    expect(await createPost(db(), author, "nope", undefined, [], undefined, gif)).toEqual({ ok: false, code: "bad_gif" });
    expect(await count("select count(*) as n from posts where author_id = ?", author)).toBe(0);
  });

  it("is hidden with the post: a private account's GIF is for its followers only", async () => {
    const owner = await member({ isPrivate: true });
    const stranger = await member();
    const id = postId(await createPost(db(), owner, "private joy", undefined, [], undefined, GIF));
    expect(await getPost(db(), stranger, id)).toBeNull();
    expect((await searchPosts(db(), stranger, "private")).items).toEqual([]);
  });

  it("goes when the post is deleted from view and when the post row is removed", async () => {
    const author = await member();
    const id = postId(await createPost(db(), author, "bye", undefined, [], undefined, GIF));
    expect(await deletePost(db(), author, id)).toEqual({ ok: true });
    expect(await getPost(db(), author, id)).toBeNull();
    await env.DB.prepare("delete from posts where id = ?").bind(id).run();
    expect(await count("select count(*) as n from post_gifs where post_id = ?", id)).toBe(0);
  });
});

describe("the database check on a GIF", () => {
  async function insertPost() {
    const author = await member();
    const id = newId("post");
    await env.DB.prepare("insert into posts (id, author_id, body) values (?, ?, 'x')").bind(id, author).run();
    return id;
  }
  const put = (id: string, url: string, width = 10, height = 10, title: string | null = null) =>
    env.DB.prepare("insert into post_gifs (post_id, url, width, height, title) values (?, ?, ?, ?, ?)").bind(id, url, width, height, title).run();

  it("takes Klipy's three media hosts", async () => {
    for (const host of ["static", "static1", "static2"]) await put(await insertPost(), `https://${host}.klipy.com/a/b.gif`);
  });

  it("refuses other hosts, other schemes, odd sizes and a long title", async () => {
    const id = await insertPost();
    await expect(put(id, "https://example.com/a.gif")).rejects.toThrow();
    await expect(put(id, "http://static.klipy.com/a.gif")).rejects.toThrow();
    await expect(put(id, "https://api.klipy.com/a.gif")).rejects.toThrow();
    await expect(put(id, "https://static.klipy.com/a.gif", 0, 10)).rejects.toThrow();
    await expect(put(id, "https://static.klipy.com/a.gif", 10, 5000)).rejects.toThrow();
    await expect(put(id, "https://static.klipy.com/a.gif", 10, 10, "x".repeat(141))).rejects.toThrow();
  });

  it("allows only one GIF per post", async () => {
    const id = await insertPost();
    await put(id, "https://static.klipy.com/a.gif");
    await expect(put(id, "https://static.klipy.com/b.gif")).rejects.toThrow();
  });
});

describe("the Klipy key", () => {
  async function ensureInstance() {
    await db()
      .insert(instance)
      .values({ id: "singleton", name: "Test", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" })
      .onConflictDoNothing();
  }
  const KEY = "kl_test_ABCDEFGH12345678";

  it("is stored encrypted, turns GIF search on, and is given out only while it is on", async () => {
    await ensureInstance();
    await removeKlipyKey(db());
    expect(await readKlipyKey(db(), ENC)).toBeNull();
    expect(await gifPanel(db(), ENC)).toEqual({ state: "off" });

    expect(await saveKlipyKey(db(), ENC, `  ${KEY}  `)).toEqual({ ok: true });
    const stored = await db().select().from(instanceSecrets);
    const row = stored.find((r) => r.name === "klipy_api_key");
    expect(row?.value).not.toContain(KEY);
    expect(await decryptSecret(row!.value, "klipy_api_key", ENC)).toBe(KEY);
    expect(await readKlipyKey(db(), ENC)).toBe(KEY);
    expect(await gifPanel(db(), ENC)).toEqual({ state: "on" });
    // The panel never carries the key.
    expect(JSON.stringify(await gifPanel(db(), ENC))).not.toContain(KEY);
  });

  it("replaces an old key, and saving twice changes nothing more", async () => {
    await ensureInstance();
    await saveKlipyKey(db(), ENC, KEY);
    await saveKlipyKey(db(), ENC, "kl_other_ABCDEFGH98765432");
    await saveKlipyKey(db(), ENC, "kl_other_ABCDEFGH98765432");
    expect(await readKlipyKey(db(), ENC)).toBe("kl_other_ABCDEFGH98765432");
    expect(await count("select count(*) as n from instance_secrets where name = 'klipy_api_key'")).toBe(1);
  });

  it("is forgotten on remove, which turns GIF search off", async () => {
    await ensureInstance();
    await saveKlipyKey(db(), ENC, KEY);
    expect(await removeKlipyKey(db())).toBe(true);
    expect(await readKlipyKey(db(), ENC)).toBeNull();
    expect(await count("select count(*) as n from instance_secrets where name = 'klipy_api_key'")).toBe(0);
    expect((await db().select().from(instance))[0]?.gifsEnabled).toBe(false);
  });

  it("is not given out when GIF search is off, even if a key is saved", async () => {
    await ensureInstance();
    await saveKlipyKey(db(), ENC, KEY);
    await env.DB.prepare("update instance set gifs_enabled = 0").run();
    expect(await readKlipyKey(db(), ENC)).toBeNull();
    expect(await gifPanel(db(), ENC)).toEqual({ state: "off" });
  });

  it("says unreadable when the encryption key has changed, and gives out nothing", async () => {
    await ensureInstance();
    await saveKlipyKey(db(), ENC, KEY);
    expect(await readKlipyKey(db(), "a-completely-different-long-encryption-key-123")).toBeNull();
    expect(await gifPanel(db(), "a-completely-different-long-encryption-key-123")).toEqual({ state: "unreadable" });
    expect(await readKlipyKey(db(), undefined)).toBeNull();
  });

  it.each([[""], ["   "], ["short"], ["has a space 1234"], ["slash/12345678"], ["q?12345678"], [42], [null]])("refuses %j", async (input) => {
    await ensureInstance();
    await removeKlipyKey(db());
    expect(await saveKlipyKey(db(), ENC, input)).toMatchObject({ ok: false });
    expect(await readKlipyKey(db(), ENC)).toBeNull();
  });

  it("is not saved without the encryption key", async () => {
    await ensureInstance();
    await removeKlipyKey(db());
    expect(await saveKlipyKey(db(), undefined, KEY)).toMatchObject({ ok: false });
    expect(await count("select count(*) as n from instance_secrets where name = 'klipy_api_key'")).toBe(0);
  });
});
