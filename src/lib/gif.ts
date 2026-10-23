// GIFs on posts (docs/PRD.md section 8.2). The picture stays at Klipy: a post keeps only the address
// Klipy gave, which must be on Klipy's own media hosts, and its size. Pure, so the rules are tested
// without a database, a page or the network.

import { z } from "zod";

/** Klipy's media hosts (from its network requirements). The only addresses a post may keep. */
export const KLIPY_MEDIA_HOSTS = ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"] as const;
export const GIF_URL_MAX = 500;
export const GIF_TITLE_MAX = 140;
export const GIF_SIZE_MAX = 4096;

export type PostGif = { url: string; width: number; height: number; title: string | null };

// Control characters and spaces never belong in an address or a title.
const CONTROL = /[\u0000-\u001F\u007F]/;

/** True for an https address on one of Klipy's media hosts, ending in .gif or .webp, with no login or port. */
export function isKlipyMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > GIF_URL_MAX || CONTROL.test(raw) || /\s/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (!(KLIPY_MEDIA_HOSTS as readonly string[]).includes(url.hostname)) return false;
  // The text must start exactly with the host: no backslash or other trick the parser would tidy away.
  if (!raw.startsWith(`https://${url.hostname}/`)) return false;
  return /\.(gif|webp)$/i.test(url.pathname);
}

export type GifCheck = { ok: true; gif: PostGif | null } | { ok: false };

/** Checks the GIF sent with a post. Nothing means no GIF; anything else odd is refused. */
export function checkGif(raw: unknown): GifCheck {
  if (raw === undefined || raw === null) return { ok: true, gif: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const { url, width, height, title } = raw as Record<string, unknown>;
  if (!isKlipyMediaUrl(url)) return { ok: false };
  const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= GIF_SIZE_MAX;
  if (!size(width) || !size(height)) return { ok: false };
  let cleanTitle: string | null = null;
  if (typeof title === "string") {
    // Line breaks and tabs become single spaces; any other control character drops the title.
    const text = title.replace(/\s+/g, " ").trim();
    if (text !== "" && !CONTROL.test(text)) cleanTitle = Array.from(text).slice(0, GIF_TITLE_MAX).join("");
  }
  return { ok: true, gif: { url, width: width as number, height: height as number, title: cleanTitle } };
}

// ---- Klipy's answer (GET /api/v1/<key>/gifs/search and /trending) ----

const format = z.object({ url: z.string(), width: z.number(), height: z.number() });
const sizes = z.record(z.string(), z.record(z.string(), format.partial().optional()).optional());
const item = z.object({ id: z.union([z.number(), z.string()]), title: z.string().optional(), file: sizes });
const answer = z.object({
  result: z.literal(true),
  data: z.object({ data: z.array(z.unknown()), has_next: z.boolean().optional() }),
});

export type GifChoice = {
  id: string;
  title: string;
  /** What the picker grid shows: a small, light picture. */
  preview: { url: string; width: number; height: number };
  /** What a post keeps. */
  post: PostGif;
};

type Format = { url?: string; width?: number; height?: number };
const find = (file: z.infer<typeof sizes>, order: [string, string][]): { url: string; width: number; height: number } | null => {
  for (const [size, kind] of order) {
    const f = file[size]?.[kind] as Format | undefined;
    if (f && isKlipyMediaUrl(f.url) && Number.isInteger(f.width) && Number.isInteger(f.height) && f.width! > 0 && f.height! > 0) {
      return { url: f.url, width: f.width!, height: f.height! };
    }
  }
  return null;
};

/** The picture a post keeps: medium, preferring the lighter animated WebP, then the GIF. Used as Klipy gave it. */
const POST_ORDER: [string, string][] = [["md", "webp"], ["md", "gif"], ["sm", "webp"], ["sm", "gif"], ["hd", "webp"], ["hd", "gif"]];
const PREVIEW_ORDER: [string, string][] = [["sm", "webp"], ["sm", "gif"], ["xs", "webp"], ["xs", "gif"], ["md", "webp"], ["md", "gif"]];

/** Turns Klipy's answer into choices in Klipy's own order. An item we cannot use is skipped, never reordered. */
export function parseKlipyPage(json: unknown): { items: GifChoice[]; hasNext: boolean } | null {
  const parsed = answer.safeParse(json);
  if (!parsed.success) return null;
  const items: GifChoice[] = [];
  for (const raw of parsed.data.data.data) {
    const one = item.safeParse(raw);
    if (!one.success) continue;
    const post = find(one.data.file, POST_ORDER);
    const preview = find(one.data.file, PREVIEW_ORDER);
    if (!post || !preview) continue;
    const title = (one.data.title ?? "").replace(/\s+/g, " ").trim();
    const checked = checkGif({ ...post, title });
    if (!checked.ok || !checked.gif) continue;
    items.push({ id: String(one.data.id), title: checked.gif.title ?? "GIF", preview, post: checked.gif });
  }
  return { items, hasNext: parsed.data.data.has_next === true };
}

/** What the browser asks Klipy: the key is in the path, as Klipy designed it. Only letters, numbers, dash and underscore are allowed in a key. */
export const KLIPY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

export function klipyUrl(key: string, query: string, page: number): string {
  const params = new URLSearchParams({ page: String(page), per_page: "24", content_filter: "medium", format_filter: "gif,webp" });
  const endpoint = query.trim() === "" ? "trending" : "search";
  if (endpoint === "search") params.set("q", query.trim());
  return `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${endpoint}?${params}`;
}
