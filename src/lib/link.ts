// The one link in a bio (docs/PRD.md section 8.4). "riya.dev" gets https:// added. Only http and
// https with a real domain; no username:password; at most 100 characters as typed.

export const LINK_MAX = 100;

/** A real domain name: at least one dot, letters, digits and hyphens in each part, a letters-only ending, not an address in numbers. */
export function looksLikeDomain(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((l) => l.length <= 63 && (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l) || /^xn--[a-z0-9-]+$/.test(l))) &&
    /^([a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1] ?? "") &&
    !/^\d+(\.\d+){3}$/.test(host)
  );
}

export type LinkResult = { ok: true; url: string } | { ok: false; reason: "too_long" | "invalid" };

export function normalizeLink(raw: string): LinkResult {
  const typed = raw.trim();
  if (typed.length > LINK_MAX) return { ok: false, reason: "too_long" };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "invalid" };
  if (url.username || url.password) return { ok: false, reason: "invalid" };

  if (!looksLikeDomain(url.hostname)) return { ok: false, reason: "invalid" };

  return { ok: true, url: url.toString() };
}

/** How a stored link is shown: without the scheme and without a lone trailing slash. */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
