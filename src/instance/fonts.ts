// Self-hosted fonts (docs/PRD.md section 5). When an admin picks a font, the Worker downloads it
// once from Google Fonts and keeps the files in our own bucket, so a reader's browser never
// contacts Google. Only families on the short open-licence list (src/instance/options.ts) can be
// fetched, and only files from Google's font host are accepted.

import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { fonts } from "@/db/schema";
import { FONT_OPTIONS } from "@/instance/options";
import { newFontKey, MEDIA_PREFIXES } from "@/storage/keys";

export const FONT_WEIGHTS = [400, 500, 600, 700] as const;
const SUBSETS = ["latin", "latin-ext"] as const;
/** A font file larger than this is refused (the biggest real latin-ext file is well under it). */
const MAX_FONT_BYTES = 600 * 1024;
const CSS_HOST = "fonts.googleapis.com";
const FILE_HOST = "fonts.gstatic.com";
// Google only sends woff2 files to a browser it knows.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type FontFaceRow = { weight: number; style: "normal" | "italic"; subset: string; unicodeRange: string; storageKey: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type HostFontResult = { ok: true; hosted: boolean } | { ok: false; message: string };

const isListed = (family: string) => (FONT_OPTIONS as readonly string[]).includes(family);

export function fontSlug(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type ParsedFace = { subset: string; style: "normal" | "italic"; weight: number; url: string; unicodeRange: string };

/** Reads the @font-face blocks Google sends. Google labels each block with its script, such as /* latin *\/. */
export function parseFontCss(css: string): ParsedFace[] {
  const out: ParsedFace[] = [];
  for (const block of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const subset = block[1]!;
    const body = block[2]!;
    if (!(SUBSETS as readonly string[]).includes(subset)) continue;
    const style = /font-style:\s*(normal|italic)\s*;/.exec(body)?.[1];
    const weight = Number(/font-weight:\s*(\d{3})\s*;/.exec(body)?.[1]);
    const url = /src:[^;]*url\(\s*(https:\/\/[^)\s]+)\s*\)\s*format\(\s*['"]woff2['"]\s*\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (style !== "normal" && style !== "italic") continue;
    if (!Number.isInteger(weight) || weight < 100 || weight > 900 || !url || !range) continue;
    if (!/^[Uu0-9A-Fa-f+,\- ?]+$/.test(range)) continue;
    out.push({ subset, style, weight, url, unicodeRange: range });
  }
  return out;
}

function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
}

function fileUrlOk(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === FILE_HOST && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/** The faces already hosted for a family, in a stable order. */
export async function readFontFaces(db: Db, family: string): Promise<FontFaceRow[]> {
  const rows = await db.select().from(fonts).where(eq(fonts.family, family));
  return rows
    .map((r) => ({ weight: r.weight, style: r.style as "normal" | "italic", subset: r.subset, unicodeRange: r.unicodeRange, storageKey: r.storageKey }))
    .sort((a, b) => a.weight - b.weight || a.subset.localeCompare(b.subset));
}

/**
 * Makes sure the family's files are in our bucket. Nothing is downloaded when they already are.
 * On any failure nothing is half-saved: files stored so far are removed and no rows are written.
 */
export async function hostFont(db: Db, bucket: R2Bucket, family: string, fetcher: Fetcher = fetch): Promise<HostFontResult> {
  if (!isListed(family)) return { ok: false, message: "That font is not on the list." };
  if ((await readFontFaces(db, family)).length > 0) return { ok: true, hosted: false };

  const fail = { ok: false, message: "Could not download the font. Phones will use a fallback until you save again." } as const;
  const stored: string[] = [];
  try {
    const cssUrl = `https://${CSS_HOST}/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${FONT_WEIGHTS.join(";")}&display=swap`;
    const cssRes = await fetcher(cssUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!cssRes.ok) return fail;
    const faces = parseFontCss(await cssRes.text()).filter((f) => f.style === "normal" && fileUrlOk(f.url));
    if (faces.length === 0) return fail;

    // Variable fonts send one file for several weights: download each address once.
    const keyByUrl = new Map<string, string>();
    for (const face of faces) {
      if (keyByUrl.has(face.url)) continue;
      const res = await fetcher(face.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("font file");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_FONT_BYTES || !isWoff2(bytes)) throw new Error("font file");
      const key = newFontKey(fontSlug(family));
      await bucket.put(key, bytes, { httpMetadata: { contentType: "font/woff2", cacheControl: "public, max-age=31536000, immutable" } });
      stored.push(key);
      keyByUrl.set(face.url, key);
    }

    await db
      .insert(fonts)
      .values(faces.map((f) => ({ family, weight: f.weight, style: f.style, subset: f.subset, unicodeRange: f.unicodeRange, storageKey: keyByUrl.get(f.url)! })))
      .onConflictDoNothing();
    return { ok: true, hosted: true };
  } catch {
    await Promise.allSettled(stored.map((k) => bucket.delete(k)));
    return fail;
  }
}

const FONT_KEY = new RegExp(`^${MEDIA_PREFIXES.font}/[a-z0-9-]{1,60}/[0-9A-Za-z]{24}\.woff2$`);

/** The @font-face rules for the page head. Every value is checked here, so none can inject CSS. */
export function fontFaceCss(family: string, faces: FontFaceRow[]): string {
  return faces
    .filter((f) => FONT_KEY.test(f.storageKey) && /^[Uu0-9A-Fa-f+,\- ?]+$/.test(f.unicodeRange) && Number.isInteger(f.weight))
    .map(
      (f) =>
        `@font-face{font-family:"${family}";font-style:${f.style === "italic" ? "italic" : "normal"};font-weight:${f.weight};font-display:swap;` +
        `src:url(/media/${f.storageKey}) format("woff2");unicode-range:${f.unicodeRange}}`,
    )
    .join("");
}
