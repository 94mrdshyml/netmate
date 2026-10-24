// Fetches a web page once and makes its card (docs/PRD.md section 8.2). The page belongs to a stranger,
// so every step is limited: only http and https on ports 80 and 443 to a real domain; the name is
// resolved over DNS-over-HTTPS first and refused if any answer is a private or special address (Workers
// cannot pin the address a name resolved to, so this check is done again for every redirect, and
// the Workers network itself also cannot reach private ranges); redirects are followed by hand, at most
// three, each checked the same way; the whole thing gets 3 seconds; at most 512 KB is read; only HTML is
// accepted. Anything that goes wrong is just "no card". Nothing is logged or stored here, and no cookie,
// login or visitor detail is sent.

import { isBlockedAddress, checkPreviewUrl } from "@/links/address";
import { charsetOf, parseCard } from "@/links/html";

export const PREVIEW_TIMEOUT_MS = 3000;
export const PREVIEW_MAX_BYTES = 512 * 1024;
export const PREVIEW_MAX_REDIRECTS = 3;
export const DOH_URL = "https://cloudflare-dns.com/dns-query";
const USER_AGENT = "netmate-self-hosted link preview";

export type LinkCard = { url: string; title: string; description: string; image: string | null; site: string };
export type LinkFailure = "unsafe" | "unreachable" | "status" | "not_html" | "no_card" | "too_many_redirects";
export type LinkFetch = { ok: true; card: LinkCard } | { ok: false; reason: LinkFailure };
export type LinkFetcher = (url: string) => Promise<LinkFetch>;

export type FetchDeps = {
  fetch: typeof fetch;
  /** The addresses a name points at, or null when they could not be found (which is treated as unsafe). */
  resolve: (host: string, signal: AbortSignal) => Promise<string[] | null>;
};

/** Looks a name up over DNS-over-HTTPS (Cloudflare's resolver, JSON form): its IPv4 and IPv6 addresses. Null on any problem. */
export async function resolveOverDoh(host: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<string[] | null> {
  const ask = async (type: "A" | "AAAA"): Promise<string[] | null> => {
    try {
      const res = await fetchFn(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { Status?: number; Answer?: { type?: number; data?: string }[] };
      // 0 is "found", 3 is "no such name"; anything else is a failure we cannot reason about.
      if (body.Status !== 0 && body.Status !== 3) return null;
      const wanted = type === "A" ? 1 : 28;
      return (body.Answer ?? []).filter((a) => a.type === wanted && typeof a.data === "string").map((a) => a.data as string);
    } catch {
      return null;
    }
  };
  const [v4, v6] = await Promise.all([ask("A"), ask("AAAA")]);
  // If either lookup failed we cannot say the name is safe, so we say nothing.
  if (v4 === null || v6 === null) return null;
  return [...v4, ...v6];
}

/** Reads at most `max` bytes of a response body, then stops it. */
async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const chunk of chunks) {
    const room = out.length - at;
    if (room <= 0) break;
    out.set(chunk.length > room ? chunk.subarray(0, room) : chunk, at);
    at += Math.min(chunk.length, room);
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const sniff = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const label = charsetOf(contentType, sniff);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * The card for an address (already the address a post links to), or why there is none. The 3 second
 * limit is also enforced by a timer around the whole thing, so a page that ignores the abort cannot hold a request open.
 */
export async function fetchLinkCard(address: string, deps: FetchDeps): Promise<LinkFetch> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<LinkFetch>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "unreachable" }), PREVIEW_TIMEOUT_MS + 250);
  });
  try {
    return await Promise.race([fetchWithinLimit(address, deps), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithinLimit(address: string, deps: FetchDeps): Promise<LinkFetch> {
  const first = checkPreviewUrl(address);
  if (!first.ok) return { ok: false, reason: "unsafe" };
  const signal = AbortSignal.timeout(PREVIEW_TIMEOUT_MS);
  let current = first.url;

  for (let hop = 0; hop <= PREVIEW_MAX_REDIRECTS; hop++) {
    // Every address, the first and each redirect, goes through the same checks.
    const check = checkPreviewUrl(current.toString());
    if (!check.ok) return { ok: false, reason: "unsafe" };
    const found = await deps.resolve(current.hostname, signal);
    if (!found || found.length === 0 || found.some(isBlockedAddress)) return { ok: false, reason: "unsafe" };

    let res: Response;
    try {
      res = await deps.fetch(current, {
        redirect: "manual",
        signal,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9", "accept-language": "en", "user-agent": USER_AGENT },
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, reason: "status" };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, reason: "status" };
      }
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "status" };
    }
    const type = res.headers.get("content-type");
    if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(type ?? "")) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "not_html" };
    }
    let bytes: Uint8Array;
    try {
      bytes = await readLimited(res, PREVIEW_MAX_BYTES);
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    // The card describes the page that was reached, and the picture is made absolute against it.
    const parsed = parseCard(decode(bytes, type), current);
    return parsed ? { ok: true, card: { url: first.url.toString(), ...parsed } } : { ok: false, reason: "no_card" };
  }
  return { ok: false, reason: "too_many_redirects" };
}

// ---- the stand-in for tests ----

/** A made-up web for the browser tests: two pages exist, everything else is unreachable. */
export const fakeFetcher: LinkFetcher = async (address) => {
  const check = checkPreviewUrl(address);
  if (!check.ok) return { ok: false, reason: "unsafe" };
  const host = check.url.hostname;
  if (host === "news.example.test") {
    return {
      ok: true,
      card: {
        url: check.url.toString(),
        title: "A made-up headline for the tests",
        description: "This page does not exist. It stands in for a news story so the card can be looked at.",
        image: "https://images.example.test/card.png",
        site: "Example News",
      },
    };
  }
  if (host === "plain.example.test") {
    return { ok: true, card: { url: check.url.toString(), title: "A page with no picture", description: "", image: null, site: "plain.example.test" } };
  }
  return { ok: false, reason: "unreachable" };
};

/** The real fetcher, or the made-up web only when the Worker was started with ENV=test (production never sets it). */
export function linkFetcherFor(env: { ENV?: string }): LinkFetcher {
  if (env.ENV === "test") return fakeFetcher;
  return (address) => fetchLinkCard(address, { fetch: (input, init) => fetch(input, init), resolve: (host, signal) => resolveOverDoh(host, fetch, signal) });
}
