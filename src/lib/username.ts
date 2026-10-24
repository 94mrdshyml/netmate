// Username rules from docs/PRD.md section 8.1.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 15;

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "auth",
  "settings",
  "home",
  "explore",
  "notifications",
  "messages",
  "search",
  "compose",
  "bookmarks",
  "analytics",
  "sign-in",
  "sign-up",
  "login",
  "logout",
  "onboarding",
  "status",
  "hq",
  "setup",
  "waiting",
  "invite",
  "profile",
  "avatar",
  "media",
  "account",
  "verify-email",
  "forgot-password",
  "reset-password",
  "support",
  "help",
  "about",
  "terms",
  "privacy",
  "report",
  "reports",
  "subscribe",
  "subscription",
  "subscriptions",
]);

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; reason: "length" | "characters" | "reserved" };

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** The instance name, lower-cased with only letters and numbers, is also reserved. */
export function reservedFromInstanceName(instanceName: string): string {
  return instanceName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function validateUsername(input: string, opts: { instanceName?: string } = {}): UsernameResult {
  const username = normalizeUsername(input);

  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return { ok: false, reason: "length" };
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return { ok: false, reason: "characters" };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: "reserved" };
  }
  if (opts.instanceName && reservedFromInstanceName(opts.instanceName) === username) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, username };
}
