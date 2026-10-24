// A link card is made by our server when someone pastes a link, but it is saved only when they post, so
// it travels through their browser in between. This signs it so the post action can tell it is the card
// our server made, for this member, a short time ago, and not one a browser invented (a made-up card
// could carry any title or picture). HMAC-SHA256 with the instance's auth secret; nothing else uses
// this key in this form.

import type { LinkCard } from "@/links/fetch";

export const CARD_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const CONTEXT = "netmate link card v1";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`${CONTEXT}:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** "payload.signature", good for 30 minutes and only for `userId`. */
export async function signLinkCard(card: LinkCard, userId: string, secret: string, now: number = Date.now()): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ c: card, u: userId, e: now + CARD_TOKEN_LIFETIME_MS })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

/** The card inside a token, or null if it is not ours, not for this member, expired or altered. */
export async function verifyLinkCard(token: unknown, userId: string, secret: string, now: number = Date.now()): Promise<LinkCard | null> {
  if (typeof token !== "string" || token.length > 4000) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const sig = fromBase64Url(signature);
  if (!sig) return null;
  // `verify` compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", await key(secret, "verify"), sig, encoder.encode(payload)))) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { c?: LinkCard; u?: string; e?: number };
    if (body.u !== userId || typeof body.e !== "number" || body.e < now || !body.c) return null;
    return body.c;
  } catch {
    return null;
  }
}
