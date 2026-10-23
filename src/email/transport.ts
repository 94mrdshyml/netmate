// How an email leaves the Worker (docs/PRD.md section 7). The real transport talks to Resend over
// HTTPS with fetch, so no package is needed. The fake transport keeps messages in memory and is
// used only when the Worker is started with ENV=test: tests never call Resend, and production,
// which never sets ENV, can never reach the fake.

import { checkResendKey, type ResendCheck } from "@/email/resend";

export type OutgoingEmail = { from: string; to: string; subject: string; html: string; text: string };
export type SendResult = { ok: true } | { ok: false; message: string };

export type Transport = {
  send(apiKey: string, email: OutgoingEmail): Promise<SendResult>;
  checkKey(apiKey: string): Promise<ResendCheck>;
};

const MAX_ERROR = 300;

/**
 * Makes Resend's own error text safe to store and show: no address and no key in it, one line,
 * and short. (CLAUDE.md: never log emails, tokens or API keys.)
 */
export function scrubError(text: string): string {
  return text
    .replace(/re_[A-Za-z0-9_]{8,}/g, "[key]")
    .replace(/[^\s<>"',;]+@[^\s<>"',;]+/g, "[address]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR);
}

export function realTransport(fetchFn: typeof fetch = fetch): Transport {
  return {
    async send(apiKey, email) {
      try {
        const res = await fetchFn("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
        if (res.status === 429 || res.status >= 500) return { ok: false, message: "Resend is busy or unreachable. Try again in a minute." };
        const message = body?.message ? scrubError(body.message) : `Resend refused the email (status ${res.status}).`;
        return { ok: false, message };
      } catch {
        return { ok: false, message: "Could not reach Resend. Check the connection and try again." };
      }
    },
    checkKey: (apiKey) => checkResendKey(apiKey, fetchFn),
  };
}

export type OutboxItem = OutgoingEmail & { at: number };
// Kept on globalThis so every route in the Worker bundle sees the same list, however it was split.
const shared = globalThis as typeof globalThis & { __netmateOutbox?: OutboxItem[] };

/** Everything the fake transport "sent", oldest first. Only the fake writes here. */
export const outbox: OutboxItem[] = (shared.__netmateOutbox ??= []);

/**
 * What the fake "sent" to one address, for the end-to-end tests to read a reset link. Null unless
 * ENV is exactly "test": anywhere else, including production, there is nothing to read.
 */
export function readOutbox(env: { ENV?: string }, to: string): OutboxItem[] | null {
  if (env.ENV !== "test") return null;
  const wanted = to.trim().toLowerCase();
  return outbox.filter((item) => item.to.toLowerCase() === wanted);
}

/**
 * The fake. A key starting `re_test_` is accepted. A sender on a `.invalid` domain is refused the
 * way Resend refuses an unverified domain, so the error path can be tried.
 */
export const fakeTransport: Transport = {
  async send(_apiKey, email) {
    const domain = email.from.split("@")[1]?.toLowerCase() ?? "";
    if (domain.endsWith(".invalid")) {
      return { ok: false, message: `The ${domain} domain is not verified. Please add and verify your domain on Resend.` };
    }
    outbox.push({ ...email, at: Date.now() });
    return { ok: true };
  },
  async checkKey(apiKey) {
    return apiKey.startsWith("re_test_") ? { ok: true } : { ok: false, reason: "invalid" };
  },
};

/** The fake only when ENV is exactly "test". Anything else, including no value, is the real one. */
export function transportFor(env: { ENV?: string }, fetchFn?: typeof fetch): Transport {
  return env.ENV === "test" ? fakeTransport : realTransport(fetchFn);
}
