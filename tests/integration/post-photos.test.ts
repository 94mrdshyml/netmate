import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { postMedia, posts, profiles, user } from "@/db/schema";
import { newId, randomId } from "@/lib/ids";
import { createPost, deletePost, getPost, listByAuthor, listFeed, listReplies, photoKeysAreValid } from "@/server/posts";
import { MAX_BYTES } from "@/storage/images";
import { isAttachable, uploadPicture } from "@/storage/upload";

const db = () => getDb(env.DB);

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: `Pho ${i}`, email: `pho${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `pho_${i}`, firstName: "Pho", lastName: String(i) });
  return id;
}

const photoKey = (userId: string, ext = "png") => `posts/${userId}/${randomId(24)}.${ext}`;

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 64) => new File([new Uint8Array([...PNG_HEAD, ...new Array(Math.max(0, size - 8)).fill(7)])], "p.png", { type: "image/png" });

describe("a post with photos", () => {
  it("keeps the photos in the order given, on the post and in every list", async () => {
    const a = await member();
    const keys = [photoKey(a), photoKey(a, "jpg"), photoKey(a, "webp")];
    const res = await createPost(db(), a, "three pictures", undefined, keys);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect((await getPost(db(), a, res.id))?.photos).toEqual(keys);
    expect((await listFeed(db(), a)).items.find((p) => p.id === res.id)?.photos).toEqual(keys);
    expect((await listByAuthor(db(), a, a)).items.find((p) => p.id === res.id)?.photos).toEqual(keys);
  });

  it("gives a post with no photos an empty list", async () => {
    const a = await member();
    const res = await createPost(db(), a, "just words");
    if (!res.ok) throw new Error(res.code);
    expect((await getPost(db(), a, res.id))?.photos).toEqual([]);
  });

  it("allows pictures with no words, shown as an empty text", async () => {
    const a = await member();
    const res = await createPost(db(), a, "   ", undefined, [photoKey(a)]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const view = await getPost(db(), a, res.id);
    expect(view?.body).toBe("");
    expect(view?.photos).toHaveLength(1);
  });

  it("still refuses a post with no words and no pictures", async () => {
    const a = await member();
    expect(await createPost(db(), a, "  ", undefined, [])).toEqual({ ok: false, code: "empty" });
  });

  it("still refuses over-long words even with pictures", async () => {
    const a = await member();
    expect(await createPost(db(), a, "x".repeat(281), undefined, [photoKey(a)])).toEqual({ ok: false, code: "too_long" });
  });

  it("works for a reply, and the reply count and alert still follow", async () => {
    const a = await member();
    const b = await member();
    const parent = await createPost(db(), a, "parent");
    if (!parent.ok) throw new Error(parent.code);
    const reply = await createPost(db(), b, "", parent.id, [photoKey(b)]);
    if (!reply.ok) throw new Error(reply.code);

    expect((await listReplies(db(), a, parent.id)).items[0]?.photos).toHaveLength(1);
    expect((await getPost(db(), a, parent.id))?.replyCount).toBe(1);
  });

  it("writes nothing when the post being answered is gone", async () => {
    const a = await member();
    const before = (await db().select().from(posts).where(eq(posts.authorId, a))).length;
    expect(await createPost(db(), a, "orphan", newId("post"), [photoKey(a)])).toEqual({ ok: false, code: "parent_not_found" });
    expect((await db().select().from(posts).where(eq(posts.authorId, a))).length).toBe(before);
  });
});

describe("which photos are accepted", () => {
  it("accepts up to four distinct photos of your own and refuses a fifth", async () => {
    const a = await member();
    const four = Array.from({ length: 4 }, () => photoKey(a));
    expect(photoKeysAreValid(a, four)).toBe(true);
    expect(await createPost(db(), a, "five", undefined, [...four, photoKey(a)])).toEqual({ ok: false, code: "bad_photos" });
  });

  it.each([
    ["someone else's photo", (_a: string, b: string) => [photoKey(b)]],
    ["a profile picture", (a: string) => [`avatars/${a}/${randomId(24)}.png`]],
    ["a path out of the folder", (a: string) => [`posts/${a}/../${randomId(24)}.png`]],
    ["a wrong extension", (a: string) => [`posts/${a}/${randomId(24)}.svg`]],
    ["a short name", (a: string) => [`posts/${a}/abc.png`]],
    ["the same photo twice", (a: string) => {
      const k = photoKey(a);
      return [k, k];
    }],
  ])("refuses %s", async (_label, make) => {
    const a = await member();
    const b = await member();
    const before = (await db().select().from(posts).where(eq(posts.authorId, a))).length;
    expect(await createPost(db(), a, "text", undefined, make(a, b))).toEqual({ ok: false, code: "bad_photos" });
    expect((await db().select().from(posts).where(eq(posts.authorId, a))).length).toBe(before);
  });

  it.each([["a string", "posts/x"], ["a number", 5], ["an object", { 0: "a" }], ["null", null]])("refuses %s in place of a list", (_label, value) => {
    expect(photoKeysAreValid("usr_aaaaaaaaaaaaaaaaaaaaaaaa", value)).toBe(false);
  });

  it("refuses a photo for an id that is not a member id", () => {
    expect(photoKeysAreValid("someone", ["posts/someone/abcdefghijklmnopqrstuvwx.png"])).toBe(false);
  });
});

describe("the database rules for photos", () => {
  it("refuses a position past the fourth", async () => {
    const a = await member();
    const post = await createPost(db(), a, "x");
    if (!post.ok) throw new Error(post.code);
    await expect(db().insert(postMedia).values({ postId: post.id, position: 4, key: photoKey(a) })).rejects.toThrow();
  });

  it("refuses a key that is not under posts/", async () => {
    const a = await member();
    const post = await createPost(db(), a, "x");
    if (!post.ok) throw new Error(post.code);
    await expect(db().insert(postMedia).values({ postId: post.id, position: 0, key: `avatars/${a}/${randomId(24)}.png` })).rejects.toThrow();
  });

  it("refuses two photos in the same place", async () => {
    const a = await member();
    const post = await createPost(db(), a, "x", undefined, [photoKey(a)]);
    if (!post.ok) throw new Error(post.code);
    await expect(db().insert(postMedia).values({ postId: post.id, position: 0, key: photoKey(a) })).rejects.toThrow();
  });

  it("removes the photo rows with the post row", async () => {
    const a = await member();
    const post = await createPost(db(), a, "x", undefined, [photoKey(a), photoKey(a)]);
    if (!post.ok) throw new Error(post.code);
    await db().delete(posts).where(eq(posts.id, post.id));
    expect(await db().select().from(postMedia).where(eq(postMedia.postId, post.id))).toHaveLength(0);
  });

  it("hides a deleted post with its photos", async () => {
    const a = await member();
    const post = await createPost(db(), a, "x", undefined, [photoKey(a)]);
    if (!post.ok) throw new Error(post.code);
    expect(await deletePost(db(), a, post.id)).toEqual({ ok: true });
    expect(await getPost(db(), a, post.id)).toBeNull();
  });
});

describe("storing a post photo", () => {
  it("keeps it under posts/ with the member's id and the right type", async () => {
    const a = await member();
    const res = await uploadPicture(env.MEDIA, a, "post", png());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toMatch(new RegExp(`^posts/${a}/[0-9A-Za-z]{24}\\.png$`));
    expect((await env.MEDIA.get(res.key))?.httpMetadata?.contentType).toBe("image/png");
  });

  it("allows 5 MB and refuses a byte more", async () => {
    const a = await member();
    expect((await uploadPicture(env.MEDIA, a, "post", png(MAX_BYTES.post))).ok).toBe(true);
    expect(await uploadPicture(env.MEDIA, a, "post", png(MAX_BYTES.post + 1))).toMatchObject({ ok: false, code: "too_big" });
  });

  it("refuses a file that only claims to be a picture", async () => {
    const a = await member();
    const fake = new File([new TextEncoder().encode("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    expect(await uploadPicture(env.MEDIA, a, "post", fake)).toMatchObject({ ok: false, code: "bad_type" });
  });

  it("is attachable only by its owner, only as a post photo, and only while it exists", async () => {
    const a = await member();
    const b = await member();
    const res = await uploadPicture(env.MEDIA, a, "post", png());
    if (!res.ok) throw new Error(res.code);

    expect(await isAttachable(env.MEDIA, a, "post", res.key)).toBe(true);
    expect(await isAttachable(env.MEDIA, b, "post", res.key)).toBe(false);
    expect(await isAttachable(env.MEDIA, a, "avatar", res.key)).toBe(false);
    await env.MEDIA.delete(res.key);
    expect(await isAttachable(env.MEDIA, a, "post", res.key)).toBe(false);
  });
});
