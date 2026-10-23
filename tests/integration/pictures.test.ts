import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { MAX_BYTES } from "@/storage/images";
import { isAttachable, uploadPicture } from "@/storage/upload";
import { getProfile, updateProfile } from "@/server/profiles";

const db = () => getDb(env.DB);
const bucket = () => env.MEDIA;

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: `Pic ${i}`, email: `pic${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `pic_${i}`, firstName: "Pic", lastName: String(i) });
  return { id, username: `pic_${i}` };
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 64, name = "me.png") => new File([new Uint8Array([...PNG_HEAD, ...new Array(Math.max(0, size - 8)).fill(7)])], name, { type: "image/png" });
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9])], "me.jpg", { type: "image/jpeg" });
const base = { firstName: "Pic", lastName: "Person", bio: "", location: "", link: "" };

async function stored(userId: string, kind: "avatar" | "banner" = "avatar") {
  const res = await uploadPicture(bucket(), userId, kind, png());
  if (!res.ok) throw new Error(`upload failed: ${res.code}`);
  return res.key;
}

describe("uploadPicture", () => {
  it("stores a real image under the person's own avatars prefix with the right type", async () => {
    const a = await member();
    const res = await uploadPicture(bucket(), a.id, "avatar", png());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toMatch(new RegExp(`^avatars/${a.id}/[0-9A-Za-z]{24}\\.png$`));
    const object = await bucket().get(res.key);
    expect(object?.httpMetadata?.contentType).toBe("image/png");
    expect(object?.size).toBe(64);
  });

  it("stores covers under banners/ and keeps the two kinds apart", async () => {
    const a = await member();
    const res = await uploadPicture(bucket(), a.id, "banner", jpeg());
    expect(res.ok && res.key.startsWith(`banners/${a.id}/`) && res.key.endsWith(".jpg")).toBe(true);
  });

  it("decides the type from the first bytes, not from the name or the claimed type", async () => {
    const a = await member();
    const disguised = new File([new Uint8Array([...PNG_HEAD, 1, 2, 3, 4])], "holiday.jpg", { type: "image/jpeg" });
    const res = await uploadPicture(bucket(), a.id, "avatar", disguised);
    expect(res.ok && res.key.endsWith(".png")).toBe(true);
  });

  it.each([
    ["an SVG named .png", () => new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], "a.png", { type: "image/png" })],
    ["HTML named .jpg", () => new File(["<html><script>alert(1)</script></html>"], "a.jpg", { type: "image/jpeg" })],
    ["a text file", () => new File(["just words"], "a.png", { type: "image/png" })],
  ])("refuses %s", async (_name, make) => {
    const a = await member();
    const before = (await bucket().list({ prefix: `avatars/${a.id}/` })).objects.length;
    const res = await uploadPicture(bucket(), a.id, "avatar", make());
    expect(res).toMatchObject({ ok: false, code: "bad_type" });
    expect((await bucket().list({ prefix: `avatars/${a.id}/` })).objects.length).toBe(before);
  });

  it("refuses an empty file, a missing file and something that is not a file", async () => {
    const a = await member();
    expect(await uploadPicture(bucket(), a.id, "avatar", new File([], "e.png"))).toMatchObject({ ok: false, code: "no_file" });
    expect(await uploadPicture(bucket(), a.id, "avatar", null)).toMatchObject({ ok: false, code: "no_file" });
    expect(await uploadPicture(bucket(), a.id, "avatar", "a string")).toMatchObject({ ok: false, code: "no_file" });
  });

  it("allows exactly the size limit and refuses one byte more, with a different limit for covers", async () => {
    const a = await member();
    expect((await uploadPicture(bucket(), a.id, "avatar", png(MAX_BYTES.avatar))).ok).toBe(true);
    expect(await uploadPicture(bucket(), a.id, "avatar", png(MAX_BYTES.avatar + 1))).toMatchObject({ ok: false, code: "too_big" });
    expect((await uploadPicture(bucket(), a.id, "banner", png(MAX_BYTES.avatar + 1))).ok).toBe(true);
    expect(await uploadPicture(bucket(), a.id, "banner", png(MAX_BYTES.banner + 1))).toMatchObject({ ok: false, code: "too_big" });
  });
});

describe("isAttachable", () => {
  it("accepts my own stored picture for the right purpose", async () => {
    const a = await member();
    expect(await isAttachable(bucket(), a.id, "avatar", await stored(a.id))).toBe(true);
    expect(await isAttachable(bucket(), a.id, "banner", await stored(a.id, "banner"))).toBe(true);
  });

  it("refuses someone else's picture, a picture used for the wrong purpose, and made-up keys", async () => {
    const a = await member();
    const b = await member();
    const mine = await stored(a.id);

    expect(await isAttachable(bucket(), b.id, "avatar", mine)).toBe(false);
    expect(await isAttachable(bucket(), a.id, "banner", mine)).toBe(false);
    expect(await isAttachable(bucket(), a.id, "avatar", `avatars/${a.id}/${"a".repeat(24)}.png`)).toBe(false);
    expect(await isAttachable(bucket(), a.id, "avatar", `avatars/${a.id}/../${b.id}/x.png`)).toBe(false);
    expect(await isAttachable(bucket(), a.id, "avatar", "instance/logo.png")).toBe(false);
    expect(await isAttachable(bucket(), a.id, "avatar", 42)).toBe(false);
    expect(await isAttachable(bucket(), a.id, "avatar", null)).toBe(false);
    expect(await isAttachable(bucket(), "not-a-user", "avatar", mine)).toBe(false);
  });

  it("refuses a stored file that is not really an image of the type its name says", async () => {
    const a = await member();
    const key = `avatars/${a.id}/${"b".repeat(24)}.png`;
    await bucket().put(key, '<svg><script>alert(1)</script></svg>');
    expect(await isAttachable(bucket(), a.id, "avatar", key)).toBe(false);

    const jpgNamedPng = `avatars/${a.id}/${"c".repeat(24)}.png`;
    await bucket().put(jpgNamedPng, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    expect(await isAttachable(bucket(), a.id, "avatar", jpgNamedPng)).toBe(false);
  });

  it("refuses an oversized or empty stored file", async () => {
    const a = await member();
    const big = `avatars/${a.id}/${"d".repeat(24)}.png`;
    await bucket().put(big, new Uint8Array([...PNG_HEAD, ...new Array(MAX_BYTES.avatar).fill(1)]));
    expect(await isAttachable(bucket(), a.id, "avatar", big)).toBe(false);
    const empty = `avatars/${a.id}/${"e".repeat(24)}.png`;
    await bucket().put(empty, new Uint8Array(0));
    expect(await isAttachable(bucket(), a.id, "avatar", empty)).toBe(false);
  });
});

describe("pictures on the profile", () => {
  it("attaches an uploaded avatar and cover and shows them on the profile", async () => {
    const a = await member();
    const avatarKey = await stored(a.id);
    const bannerKey = await stored(a.id, "banner");

    expect(await updateProfile(db(), a.id, { ...base, avatarKey, bannerKey }, bucket())).toEqual({ ok: true });

    expect(await getProfile(db(), a.id, a.username)).toMatchObject({ avatarKey, bannerKey });
  });

  it("keeps the pictures when the form does not mention them", async () => {
    const a = await member();
    const avatarKey = await stored(a.id);
    await updateProfile(db(), a.id, { ...base, avatarKey }, bucket());

    await updateProfile(db(), a.id, { ...base, bio: "changed" }, bucket());

    expect(await getProfile(db(), a.id, a.username)).toMatchObject({ avatarKey, bio: "changed" });
    expect(await bucket().head(avatarKey)).not.toBeNull();
  });

  it("deletes the old file when a picture is replaced, but not when it is saved again unchanged", async () => {
    const a = await member();
    const first = await stored(a.id);
    await updateProfile(db(), a.id, { ...base, avatarKey: first }, bucket());
    await updateProfile(db(), a.id, { ...base, avatarKey: first }, bucket());
    expect(await bucket().head(first)).not.toBeNull();

    const second = await stored(a.id);
    await updateProfile(db(), a.id, { ...base, avatarKey: second }, bucket());

    expect(await bucket().head(first)).toBeNull();
    expect(await bucket().head(second)).not.toBeNull();
    expect((await getProfile(db(), a.id, a.username))?.avatarKey).toBe(second);
  });

  it("removes a picture, back to the default, and deletes the file", async () => {
    const a = await member();
    const key = await stored(a.id);
    await updateProfile(db(), a.id, { ...base, avatarKey: key }, bucket());

    expect(await updateProfile(db(), a.id, { ...base, avatarKey: null }, bucket())).toEqual({ ok: true });

    expect((await getProfile(db(), a.id, a.username))?.avatarKey).toBeNull();
    expect(await bucket().head(key)).toBeNull();
  });

  it("refuses to attach someone else's picture, and changes nothing else when it does", async () => {
    const a = await member();
    const b = await member();
    const theirs = await stored(b.id);

    const res = await updateProfile(db(), a.id, { ...base, bio: "new bio", avatarKey: theirs }, bucket());

    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { avatar: expect.any(String) } });
    expect(await getProfile(db(), a.id, a.username)).toMatchObject({ avatarKey: null, bio: "" });
    expect(await bucket().head(theirs)).not.toBeNull();
  });

  it("refuses a picture key when no storage is given, instead of trusting it", async () => {
    const a = await member();
    const key = await stored(a.id);
    expect(await updateProfile(db(), a.id, { ...base, avatarKey: key })).toMatchObject({ ok: false, code: "invalid" });
  });
});
