// Web addresses in the text of a post (docs/PRD.md section 8.2). They are found by parsing the text,
// never by building markup: the page draws each one as a link, and the first one can get a preview card.
// Pure, so the rules are tested without a database or a page.

import { looksLikeDomain } from "@/lib/link";

export const POST_LINK_MAX = 500;

export type FoundLink = { start: number; end: number; text: string; href: string };

// A web address starts with http:// or https:// or www. and runs to the next space or bracket-like character.
const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
// Punctuation at the end belongs to the sentence, not the address ("see https://x.com/a.").
const TRAILING = /[.,;:!?'")\]}»”’]+$/;

/**
 * The address to open for what was typed, or null when it is not one: only http and https, a real
 * domain name (never a bare number, `localhost` or an address in brackets), no login in it, at most
 * 500 characters. "www.site.org" becomes "https://www.site.org/".
 */
export function normalizePostLink(raw: string): string | null {
  if (raw.length > POST_LINK_MAX) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : /^www\./i.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!looksLikeDomain(url.hostname)) return null;
  const href = url.toString();
  return href.length <= POST_LINK_MAX ? href : null;
}

/** Every web address in the text, in order, with where it sits so the text can be cut around it. */
export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    let candidate = match[0];
    // Keep a closing bracket that belongs to the address: "https://en.wikipedia.org/wiki/Foo_(bar)".
    for (;;) {
      const stripped = candidate.replace(TRAILING, (tail) => {
        let keep = 0;
        if (candidate.includes("(")) {
          const opens = (candidate.match(/\(/g) ?? []).length;
          const closes = (candidate.match(/\)/g) ?? []).length;
          const spare = opens - closes + (tail.match(/\)/g) ?? []).length;
          // Only as many closing brackets as there are opening ones, and only if they lead the tail.
          while (keep < tail.length && tail[keep] === ")" && keep < spare) keep += 1;
        }
        return tail.slice(0, keep);
      });
      if (stripped === candidate) break;
      candidate = stripped;
    }
    const href = normalizePostLink(candidate);
    if (!href) continue;
    const start = match.index ?? 0;
    found.push({ start, end: start + candidate.length, text: candidate, href });
  }
  return found;
}

/** The address of the first link in the text, the one a preview card is made for. */
export function firstLink(text: string): string | null {
  return findLinks(text)[0]?.href ?? null;
}
