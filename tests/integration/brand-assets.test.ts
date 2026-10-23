import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { fonts, instance } from "@/db/schema";
import { saveBrandingForm } from "@/instance/branding";
import { fontFaceCss, hostFont } from "@/instance/fonts";
import { readInstance } from "@/instance/settings";
import { BRAND_MAX_BYTES, isBrandFileAttachable, removeBrandFile, uploadBrandFile } from "@/storage/brand-files";
import { SVG_LOGO, pngHeader } from "../support/png";

const db = () => getDb(env.DB);
const bucket = () => env.MEDIA;

type Bytes = Uint8Array<ArrayBuffer>;
const file = (bytes: Bytes | string, name = "x.png") => new File([typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes], name);

async function stored(kind: "logo" | "favicon", bytes: Bytes | string) {
  const res = await uploadBrandFile(bucket(), kind, file(bytes));
  if (!res.ok) throw new Error(`upload failed: ${res.code}`);
  return res.key;
}

async function exists(key: string) {
  return (await bucket().head(key)) !== null;
}

describe("uploadBrandFile", () => {
  it("stores a PNG logo under instance/ with its real type", async () => {
    const res = await uploadBrandFile(bucket(), "logo", file(pngHeader(200, 60)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toMatch(/^instance\/[0-9A-Za-z]{24}\.png$/);
    const object = await bucket().head(res.key);
    expect(object?.httpMetadata?.contentType).toBe("image/png");
  });

  it("stores an SVG favicon as image/svg+xml", async () => {
    const res = await uploadBrandFile(bucket(), "favicon", file(SVG_LOGO, "icon.svg"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toMatch(/\.svg$/);
    expect((await bucket().head(res.key))?.httpMetadata?.contentType).toBe("image/svg+xml");
  });

  it("decides the type from the bytes, not the file name", async () => {
    const res = await uploadBrandFile(bucket(), "logo", file(SVG_LOGO, "logo.png"));
    expect(res.ok && res.type).toBe("svg");
  });

  it.each([
    ["nothing", undefined, "no_file"],
    ["an empty file", new File([], "e.png"), "no_file"],
    ["a text file", file("hello there", "a.txt"), "bad_type"],
    ["a JPEG", file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]), "a.jpg"), "bad_type"],
    ["an SVG with a script", file('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', "a.svg"), "bad_svg"],
    ["a file over 1 MB", file(new Uint8Array(BRAND_MAX_BYTES.logo + 1), "big.png"), "too_big"],
  ])("refuses %s and stores nothing", async (_label, input, code) => {
    const before = (await bucket().list({ prefix: "instance/" })).objects.length;
    const res = await uploadBrandFile(bucket(), "logo", input);
    expect(res).toMatchObject({ ok: false, code });
    expect((await bucket().list({ prefix: "instance/" })).objects.length).toBe(before);
  });

  it("refuses a favicon that is small or not square", async () => {
    expect(await uploadBrandFile(bucket(), "favicon", file(pngHeader(256, 256)))).toMatchObject({ ok: false, code: "bad_size" });
    expect(await uploadBrandFile(bucket(), "favicon", file(pngHeader(512, 600)))).toMatchObject({ ok: false, code: "bad_size" });
    expect(await uploadBrandFile(bucket(), "favicon", file(pngHeader(512, 512)))).toMatchObject({ ok: true });
  });
});

describe("isBrandFileAttachable", () => {
  it("accepts a file that was stored and still passes the checks", async () => {
    const key = await stored("logo", pngHeader(100, 100));
    expect(await isBrandFileAttachable(bucket(), "logo", key)).toBe(true);
  });

  it("checks the favicon rules again, so a logo cannot be attached as a favicon", async () => {
    const key = await stored("logo", pngHeader(100, 100));
    expect(await isBrandFileAttachable(bucket(), "favicon", key)).toBe(false);
  });

  it("refuses keys that are missing, malformed, or from another prefix", async () => {
    expect(await isBrandFileAttachable(bucket(), "logo", "instance/aaaaaaaaaaaaaaaaaaaaaaaa.png")).toBe(false);
    expect(await isBrandFileAttachable(bucket(), "logo", "instance/../avatars/x.png")).toBe(false);
    expect(await isBrandFileAttachable(bucket(), "logo", "avatars/usr_aaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaa.png")).toBe(false);
    expect(await isBrandFileAttachable(bucket(), "logo", null)).toBe(false);
    expect(await isBrandFileAttachable(bucket(), "logo", 42)).toBe(false);
  });

  it("refuses a stored file whose bytes no longer pass (named png, holds something else)", async () => {
    const key = "instance/ZZZZZZZZZZZZZZZZZZZZZZZZ.png";
    await bucket().put(key, new TextEncoder().encode("not a picture"));
    expect(await isBrandFileAttachable(bucket(), "logo", key)).toBe(false);
  });
});

describe("removeBrandFile", () => {
  it("deletes a file under instance/ and ignores null and foreign keys", async () => {
    const key = await stored("logo", pngHeader(50, 50));
    await removeBrandFile(bucket(), key);
    expect(await exists(key)).toBe(false);

    const other = "avatars/usr_aaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaa.png";
    await bucket().put(other, new Uint8Array([1]));
    await removeBrandFile(bucket(), other);
    await removeBrandFile(bucket(), null);
    expect(await exists(other)).toBe(true);
  });
});

// --- fonts ---------------------------------------------------------------------------------

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6]);
const block = (subset: string, weight: number, file: string, host = "fonts.gstatic.com") => `/* ${subset} */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  src: url(https://${host}/s/inter/${file}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

function fakeGoogle(css: string, files: Record<string, Bytes | number>) {
  const calls: string[] = [];
  const fetcher = async (input: string) => {
    calls.push(input);
    if (input.startsWith("https://fonts.googleapis.com/css2?")) return new Response(css);
    const hit = files[input.split("/").pop()!];
    if (hit === undefined) return new Response("no", { status: 404 });
    if (typeof hit === "number") return new Response("error", { status: hit });
    return new Response(hit);
  };
  return { fetcher, calls };
}

const GOOD_CSS = block("latin", 400, "a") + block("latin", 700, "a") + block("latin-ext", 400, "b") + block("latin-ext", 700, "b");

beforeEach(async () => {
  await db().delete(fonts);
});

describe("hostFont", () => {
  it("downloads each file once (variable fonts share one), stores them, and records every weight", async () => {
    const { fetcher, calls } = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 });
    const res = await hostFont(db(), bucket(), "Inter", fetcher);

    expect(res).toEqual({ ok: true, hosted: true });
    // One stylesheet request and two files, even though four faces were listed.
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("family=Inter:wght@400;500;600;700");

    const rows = await db().select().from(fonts);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.storageKey).toMatch(/^fonts\/inter\/[0-9A-Za-z]{24}\.woff2$/);
      const object = await bucket().head(row.storageKey);
      expect(object?.httpMetadata?.contentType).toBe("font/woff2");
    }
    expect(new Set(rows.map((r) => r.storageKey)).size).toBe(2);
  });

  it("writes the family name with a plus for a space", async () => {
    const { fetcher, calls } = fakeGoogle("", {});
    await hostFont(db(), bucket(), "DM Sans", fetcher);
    expect(calls[0]).toContain("family=DM+Sans:wght@");
  });

  it("does nothing when the family is already hosted", async () => {
    const first = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 });
    await hostFont(db(), bucket(), "Inter", first.fetcher);
    const second = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 });
    expect(await hostFont(db(), bucket(), "Inter", second.fetcher)).toEqual({ ok: true, hosted: false });
    expect(second.calls).toHaveLength(0);
  });

  it("refuses a family that is not on the list, without contacting anyone", async () => {
    const { fetcher, calls } = fakeGoogle(GOOD_CSS, {});
    expect(await hostFont(db(), bucket(), "Comic Sans MS", fetcher)).toMatchObject({ ok: false });
    expect(await hostFont(db(), bucket(), 'Inter";}*{display:none', fetcher)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("fails cleanly when the stylesheet request fails", async () => {
    const fetcher = async () => new Response("down", { status: 503 });
    expect(await hostFont(db(), bucket(), "Inter", fetcher)).toMatchObject({ ok: false });
    expect(await db().select().from(fonts)).toHaveLength(0);
  });

  it("refuses files that are not on Google's font host", async () => {
    const css = block("latin", 400, "a", "evil.example.com");
    const { fetcher, calls } = fakeGoogle(css, { "a.woff2": WOFF2 });
    expect(await hostFont(db(), bucket(), "Inter", fetcher)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
    expect(await db().select().from(fonts)).toHaveLength(0);
  });

  it("keeps nothing when a later file fails: no rows and the earlier file is removed", async () => {
    const before = (await bucket().list({ prefix: "fonts/" })).objects.length;
    const { fetcher } = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": 500 });
    expect(await hostFont(db(), bucket(), "Inter", fetcher)).toMatchObject({ ok: false });
    expect(await db().select().from(fonts)).toHaveLength(0);
    expect((await bucket().list({ prefix: "fonts/" })).objects.length).toBe(before);
  });

  it("refuses a file that is not a woff2 and one that is too big", async () => {
    const notFont = fakeGoogle(GOOD_CSS, { "a.woff2": new Uint8Array([1, 2, 3, 4, 5, 6]), "b.woff2": WOFF2 });
    expect(await hostFont(db(), bucket(), "Inter", notFont.fetcher)).toMatchObject({ ok: false });

    const huge: Bytes = new Uint8Array(600 * 1024 + 1);
    huge.set(WOFF2);
    const big = fakeGoogle(GOOD_CSS, { "a.woff2": huge, "b.woff2": WOFF2 });
    expect(await hostFont(db(), bucket(), "Inter", big.fetcher)).toMatchObject({ ok: false });
    expect(await db().select().from(fonts)).toHaveLength(0);
  });

  it("turns hosted files into css the page can use", async () => {
    const { fetcher } = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 });
    await hostFont(db(), bucket(), "Inter", fetcher);
    await resetInstance();
    const { fontFaces } = await readInstance(db());
    const css = fontFaceCss("Inter", fontFaces);
    expect(fontFaces).toHaveLength(4);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toMatch(/url\(\/media\/fonts\/inter\/[0-9A-Za-z]{24}\.woff2\)/);
  });
});

describe("fonts table rules", () => {
  const row = { family: "Inter", weight: 400, style: "normal", subset: "latin", unicodeRange: "U+0000", storageKey: "fonts/inter/x.woff2" };

  async function refused(values: Partial<typeof row>) {
    let failed = false;
    try {
      await db().insert(fonts).values({ ...row, ...values });
    } catch {
      failed = true;
    }
    return failed;
  }

  it("accepts a good row and refuses a bad weight, style, subset or a repeat", async () => {
    expect(await refused({})).toBe(false);
    expect(await refused({})).toBe(true); // same family, weight, style and subset
    expect(await refused({ weight: 50 })).toBe(true);
    expect(await refused({ weight: 1000 })).toBe(true);
    expect(await refused({ style: "oblique" })).toBe(true);
    expect(await refused({ subset: "greek" })).toBe(true);
  });
});

// --- the whole form ------------------------------------------------------------------------

const good = { name: "Greenfield", primary: "#0B6E4F", radius: "lg", fontFamily: "Inter", avatarStyle: "rings" };

async function resetInstance() {
  await db()
    .insert(instance)
    .values({ id: "singleton", name: "Before", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" })
    .onConflictDoNothing();
  await db().update(instance).set({ name: "Before", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials", logoKey: null, faviconKey: null });
}

const okFonts = () => fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 }).fetcher;
const downFonts = async () => new Response("down", { status: 503 });

describe("saveBrandingForm", () => {
  beforeEach(resetInstance);

  it("attaches a logo and a favicon and downloads the font", async () => {
    const logoKey = await stored("logo", pngHeader(120, 40));
    const faviconKey = await stored("favicon", pngHeader(512, 512));
    const res = await saveBrandingForm(db(), bucket(), { ...good, logoKey, faviconKey }, okFonts());

    expect(res).toEqual({ ok: true });
    const state = await readInstance(db());
    expect(state.settings).toMatchObject({ logoKey, faviconKey, name: "Greenfield" });
    expect(state.fontFaces.length).toBeGreaterThan(0);
  });

  it("leaves the files alone when the form does not mention them", async () => {
    const logoKey = await stored("logo", pngHeader(120, 40));
    await saveBrandingForm(db(), bucket(), { ...good, logoKey }, okFonts());
    await saveBrandingForm(db(), bucket(), { ...good, name: "Renamed" }, okFonts());
    expect((await readInstance(db())).settings).toMatchObject({ logoKey, name: "Renamed" });
    expect(await exists(logoKey)).toBe(true);
  });

  it("removes the old file after a replacement, and a null clears it", async () => {
    const first = await stored("logo", pngHeader(120, 40));
    await saveBrandingForm(db(), bucket(), { ...good, logoKey: first }, okFonts());

    const second = await stored("logo", pngHeader(130, 40));
    await saveBrandingForm(db(), bucket(), { ...good, logoKey: second }, okFonts());
    expect((await readInstance(db())).settings.logoKey).toBe(second);
    expect(await exists(first)).toBe(false);

    await saveBrandingForm(db(), bucket(), { ...good, logoKey: null }, okFonts());
    expect((await readInstance(db())).settings.logoKey).toBeNull();
    expect(await exists(second)).toBe(false);
  });

  it("saves nothing at all when a file cannot be attached", async () => {
    const res = await saveBrandingForm(db(), bucket(), { ...good, logoKey: "instance/aaaaaaaaaaaaaaaaaaaaaaaa.png" }, okFonts());
    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { logoKey: expect.any(String) } });
    expect((await readInstance(db())).settings).toMatchObject({ name: "Before", logoKey: null });
  });

  it("will not attach someone else's kind of file: a logo-sized picture is not a favicon", async () => {
    const small = await stored("logo", pngHeader(100, 100));
    const res = await saveBrandingForm(db(), bucket(), { ...good, faviconKey: small }, okFonts());
    expect(res).toMatchObject({ ok: false, fieldErrors: { faviconKey: expect.any(String) } });
  });

  it("will not attach a key that points outside instance/", async () => {
    await bucket().put("avatars/usr_aaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaa.png", pngHeader(600, 600));
    const res = await saveBrandingForm(db(), bucket(), { ...good, logoKey: "avatars/usr_aaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaa.png" }, okFonts());
    expect(res.ok).toBe(false);
  });

  it("still validates the five fields", async () => {
    const res = await saveBrandingForm(db(), bucket(), { ...good, primary: "red" }, okFonts());
    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { primary: expect.any(String) } });
  });

  it("saves everything but warns when the font cannot be downloaded, and a second save tries again", async () => {
    const res = await saveBrandingForm(db(), bucket(), good, downFonts);
    expect(res).toMatchObject({ ok: true, warning: expect.stringContaining("font") });
    expect((await readInstance(db())).settings.name).toBe("Greenfield");
    expect((await readInstance(db())).fontFaces).toHaveLength(0);

    expect(await saveBrandingForm(db(), bucket(), good, okFonts())).toEqual({ ok: true });
    expect((await readInstance(db())).fontFaces.length).toBeGreaterThan(0);
  });

  it("does not download again when the font is already hosted", async () => {
    await saveBrandingForm(db(), bucket(), good, okFonts());
    const spy = fakeGoogle(GOOD_CSS, { "a.woff2": WOFF2, "b.woff2": WOFF2 });
    await saveBrandingForm(db(), bucket(), { ...good, name: "Again" }, spy.fetcher);
    expect(spy.calls).toHaveLength(0);
  });

  it("fails plainly when the instance is not set up", async () => {
    await db().delete(instance);
    expect(await saveBrandingForm(db(), bucket(), good, okFonts())).toMatchObject({ ok: false, code: "failed" });
  });
});
