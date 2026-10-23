// The instance logo and favicon (docs/PRD.md section 5). PNG or SVG only. An SVG is read as text
// and refused if it could run anything, so a stored logo is only ever a picture. The file's own
// bytes decide the type, never its name or what the browser claims.

import { MEDIA_PREFIXES, newInstanceKey } from "@/storage/keys";
import { sniffImage } from "@/storage/images";

export type BrandFileKind = "logo" | "favicon";
export type BrandFileType = "png" | "svg";

export const BRAND_MAX_BYTES = { logo: 1024 * 1024, favicon: 1024 * 1024 } as const;
/** A favicon PNG must be at least this many pixels on each side, and square. */
export const FAVICON_MIN_PIXELS = 512;
const PNG_MAX_PIXELS = 8192;

export const BRAND_MIME: Record<BrandFileType, string> = { png: "image/png", svg: "image/svg+xml" };

export type BrandFileResult =
  | { ok: true; key: string; type: BrandFileType }
  | { ok: false; code: "no_file" | "too_big" | "bad_type" | "bad_svg" | "bad_size" | "failed"; message: string };

const MESSAGES = {
  no_file: "Choose a file first.",
  too_big: (kind: BrandFileKind) => `That file is too big. The ${kind} can be up to ${BRAND_MAX_BYTES[kind] / (1024 * 1024)} MB.`,
  bad_type: "Use a PNG or SVG file.",
  bad_svg: "That SVG cannot be used. Remove scripts, links and embedded content, or use a PNG.",
  bad_size: (kind: BrandFileKind) =>
    kind === "favicon" ? `The favicon must be square and at least ${FAVICON_MIN_PIXELS} pixels wide, or an SVG.` : "That picture has an unusable size.",
  failed: "The file could not be saved. Try again.",
} as const;

/** Width and height from a PNG's header, or null if it is not a readable PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || sniffImage(bytes) !== "png") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The first chunk must be IHDR.
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * True only for a plain drawing: an <svg> with no script, no event handler, no link to anything
 * outside the file, no embedded page or picture, and no entity tricks.
 */
export function isSafeSvg(text: string): boolean {
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>[]*>\s*)?<svg[\s>]/i.test(text)) return false;
  if (!/<\/svg>\s*$/i.test(text)) return false;
  const bad = [
    /<script/i,
    /<foreignObject/i,
    /<iframe/i,
    /<embed/i,
    /<object/i,
    /<image/i,
    /<use[\s/>]/i,
    /<animate/i,
    /<set[\s/>]/i,
    /<style/i,
    /<!ENTITY/i,
    /<!\[CDATA\[/i,
    /\son\w+\s*=/i,
    /javascript:/i,
    /data:/i,
    /(?:xlink:)?href\s*=/i,
    /url\(\s*["']?(?!#)/i,
    /@import/i,
  ];
  return !bad.some((re) => re.test(text));
}

export type CheckedBrandFile = { type: BrandFileType } | { error: Exclude<BrandFileResult, { ok: true }>["code"] };

/** Decides what a file is and whether it may be the logo or favicon. */
export function checkBrandBytes(kind: BrandFileKind, bytes: Uint8Array): CheckedBrandFile {
  if (bytes.length === 0) return { error: "no_file" };
  if (bytes.length > BRAND_MAX_BYTES[kind]) return { error: "too_big" };

  if (sniffImage(bytes) === "png") {
    const size = pngSize(bytes);
    if (!size || size.width < 1 || size.height < 1 || size.width > PNG_MAX_PIXELS || size.height > PNG_MAX_PIXELS) return { error: "bad_size" };
    if (kind === "favicon" && (size.width !== size.height || size.width < FAVICON_MIN_PIXELS)) return { error: "bad_size" };
    return { type: "png" };
  }

  // Not a picture format we know, so it can only be an SVG if it is text.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "bad_type" };
  }
  if (!/<svg[\s>]/i.test(text)) return { error: "bad_type" };
  return isSafeSvg(text) ? { type: "svg" } : { error: "bad_svg" };
}

function explain(kind: BrandFileKind, code: Exclude<BrandFileResult, { ok: true }>["code"]): string {
  const m = MESSAGES[code];
  return typeof m === "function" ? m(kind) : m;
}

/** Checks a posted file and stores it under `instance/`. */
export async function uploadBrandFile(bucket: R2Bucket, kind: BrandFileKind, file: unknown): Promise<BrandFileResult> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "no_file", message: MESSAGES.no_file };
  if (file.size > BRAND_MAX_BYTES[kind]) return { ok: false, code: "too_big", message: explain(kind, "too_big") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkBrandBytes(kind, bytes);
  if ("error" in checked) return { ok: false, code: checked.error, message: explain(kind, checked.error) };

  const key = newInstanceKey(checked.type);
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: BRAND_MIME[checked.type], cacheControl: "public, max-age=31536000, immutable" },
    });
  } catch {
    return { ok: false, code: "failed", message: MESSAGES.failed };
  }
  return { ok: true, key, type: checked.type };
}

const KEY_PATTERN = new RegExp(`^${MEDIA_PREFIXES.instance}/[0-9A-Za-z]{24}\.(png|svg)$`);

/** True only when `key` is a stored file of ours that still exists and passes the checks again. */
export async function isBrandFileAttachable(bucket: R2Bucket, kind: BrandFileKind, key: unknown): Promise<boolean> {
  if (typeof key !== "string") return false;
  const match = KEY_PATTERN.exec(key);
  if (!match) return false;
  const object = await bucket.get(key);
  if (!object) return false;
  const checked = checkBrandBytes(kind, new Uint8Array(await object.arrayBuffer()));
  return "type" in checked && checked.type === match[1];
}

/** Removes a replaced file. A failure only leaves an unused file behind. */
export async function removeBrandFile(bucket: R2Bucket, key: string | null): Promise<void> {
  if (!key || !KEY_PATTERN.test(key)) return;
  try {
    await bucket.delete(key);
  } catch {
    // Already detached from the instance; a later clean-up can remove the file.
  }
}
