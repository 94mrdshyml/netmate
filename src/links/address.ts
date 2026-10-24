// Which addresses the link-preview fetcher may talk to (docs/PRD.md section 8.2, CLAUDE.md gotchas).
// A post can contain any address, so the server must not be led to its own network, to a cloud
// metadata address, or to a neighbour's machine. Workers cannot pin the address a name resolved to, so
// the fetcher resolves the name over DNS-over-HTTPS first, refuses the page if any answer is a private,
// loopback, link-local or otherwise special address, and does this again for every redirect. This file
// holds the rules; it is pure and tested without the network.

import { looksLikeDomain } from "@/lib/link";

export type PreviewUrlCheck = { ok: true; url: URL } | { ok: false; reason: "scheme" | "port" | "login" | "host" | "length" };

const MAX_URL = 500;
// Names that are only ever inside a private network.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".private", ".localdomain"];

/**
 * Whether a preview may even be attempted for this address: http or https on the usual ports, no
 * login, and a real domain name (never a number, a bracketed address, `localhost` or a private-network suffix).
 */
export function checkPreviewUrl(raw: string): PreviewUrlCheck {
  if (raw.length > MAX_URL) return { ok: false, reason: "length" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "host" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "login" };
  // The URL parser drops a port that is the default for the scheme, so any port left is an unusual one.
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return { ok: false, reason: "port" };
  const host = url.hostname.toLowerCase();
  if (!looksLikeDomain(host) || host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "host" };
  return { ok: true, url };
}

// ---- numeric addresses ----

/** "10.0.0.1" as four numbers, or null. */
export function parseIPv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** An IPv6 address as eight 16-bit groups, or null. Understands "::" and a trailing IPv4 part. */
export function parseIPv6(text: string): number[] | null {
  let s = text.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  s = s.split("%")[0] ?? s;
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) {
    groups[6] = tail[0]!;
    groups[7] = tail[1]!;
  }
  return groups;
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 || // private
    (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b! >= 16 && b! <= 31) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments and documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a! >= 224 // multicast, reserved and broadcast
  );
}

/**
 * True for any address a preview must never be fetched from: private, loopback, link-local, carrier-grade
 * NAT, multicast, reserved and documentation ranges, in IPv4 and IPv6 (including IPv4 inside IPv6, as
 * "::ffff:10.0.0.1" or through NAT64 and 6to4). Text that is not an address at all is also refused.
 */
export function isBlockedAddress(text: string): boolean {
  const v4 = parseIPv4(text);
  if (v4) return blockedV4(v4);
  const g = parseIPv6(text);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return true; // ::
  if (zeros(7) && g[7] === 1) return true; // ::1
  if (zeros(5) && g[5] === 0xffff) return blockedV4(embedded(g[6]!, g[7]!)); // ::ffff:a.b.c.d (mapped)
  if (zeros(6)) return true; // ::a.b.c.d (the old compatible form)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(embedded(g[6]!, g[7]!)); // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x2002) return blockedV4(embedded(g[1]!, g[2]!)); // 6to4 carries an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only 100::/64
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // old site-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}
