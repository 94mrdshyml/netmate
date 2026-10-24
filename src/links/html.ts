// Reads the card of a web page from its HTML (docs/PRD.md section 8.2): the Open Graph tags that
// sites publish for exactly this ("og:title", "og:description", "og:image", "og:site_name"), then
// Twitter's, then the plain title and description. Everything that comes out is plain text with a
// length limit; the picture must be an https address of a real domain. Pure, so it is tested without
// the network. The page is hostile input: nothing here builds markup or runs anything.

import { looksLikeDomain } from "@/lib/link";

export const TITLE_MAX = 150;
export const DESCRIPTION_MAX = 300;
export const SITE_MAX = 60;
export const IMAGE_MAX = 500;

export type PageCard = { title: string; description: string; image: string | null; site: string };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", ndash: "-", mdash: "-", hellip: "...",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', bull: "-", middot: "·", laquo: "«", raquo: "»", eacute: "é", egrave: "è",
};

/** Turns "&amp;", "&#39;" and "&#x1F600;" back into characters. Unknown names are left as typed. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** One line of plain text, cut at `max` characters (counted as a person counts them, near enough) with "..." when cut. */
export function cleanText(raw: string, max: number): string {
  // Control characters and the invisible ones that flip text direction have no place in a card.
  const text = decodeEntities(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const letters = Array.from(text);
  return letters.length <= max ? text : `${letters.slice(0, max - 3).join("").trimEnd()}...`;
}

/** The attributes of one tag as a lower-cased map. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** A picture address the reader's phone may be sent to: https, a real domain, no login, not too long. */
export function cardImage(raw: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443")) return null;
  if (!looksLikeDomain(url.hostname)) return null;
  const href = url.toString();
  return href.length <= IMAGE_MAX ? href : null;
}

function siteFrom(url: URL): string {
  return url.hostname.replace(/^www\./i, "");
}

/** The card for a page fetched from `base`, or null when it has no title to show. */
export function parseCard(html: string, base: URL): PageCard | null {
  // Only the head matters; stopping at its end keeps a huge body from being scanned for nothing.
  const head = html.slice(0, Math.max(html.search(/<\/head\s*>/i), 0) || html.length);
  const meta = new Map<string, string>();
  // A ">" inside a quoted value does not end the tag.
  for (const m of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = attributes(m[0]);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const pageTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? "";

  const title = cleanText(meta.get("og:title") ?? meta.get("twitter:title") ?? pageTitle, TITLE_MAX);
  if (title === "") return null;
  const description = cleanText(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description") ?? "", DESCRIPTION_MAX);
  const imageRaw = meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image") ?? meta.get("twitter:image:src");
  const image = imageRaw ? cardImage(decodeEntities(imageRaw), base) : null;
  const site = cleanText(meta.get("og:site_name") ?? "", SITE_MAX) || siteFrom(base);
  return { title, description, image, site };
}

/** The character set a page says it uses, from its Content-Type or its first bytes, for decoding. */
export function charsetOf(contentType: string | null, firstBytes: string): string {
  const fromHeader = /charset\s*=\s*["']?([a-z0-9_.:-]+)/i.exec(contentType ?? "")?.[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_.:-]+)/i.exec(firstBytes)?.[1];
  return (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
}
