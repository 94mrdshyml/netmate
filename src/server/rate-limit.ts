// Exact low-volume limits kept in D1 (docs/PRD.md section 8.11). The check and the record are
// one SQL statement, so two requests at the same moment cannot both take the last slot.
// Keys hold a label and a salted hash, never a raw IP address or email.

export type Limit = { name: string; max: number; windowMs: number };

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

const MINUTE = 60_000;

/** Limits from the PRD table. Sign-up per link is not in the table ("also limited"): 20 per 10 minutes. */
export const LIMITS = {
  signInIp: { name: "signin:ip", max: 30, windowMs: 10 * MINUTE },
  signInEmail: { name: "signin:email", max: 10, windowMs: 10 * MINUTE },
  signUpIp: { name: "signup:ip", max: 10, windowMs: 10 * MINUTE },
  signUpLink: { name: "signup:link", max: 20, windowMs: 10 * MINUTE },
  posts: { name: "posts", max: 10, windowMs: MINUTE },
  likes: { name: "likes", max: 60, windowMs: MINUTE },
  reposts: { name: "reposts", max: 30, windowMs: MINUTE },
  saves: { name: "saves", max: 60, windowMs: MINUTE },
  follows: { name: "follows", max: 30, windowMs: 10 * MINUTE },
  uploads: { name: "uploads", max: 30, windowMs: 10 * MINUTE },
  places: { name: "places", max: 40, windowMs: MINUTE },
  mentions: { name: "mentions", max: 120, windowMs: MINUTE },
  testEmail: { name: "email:test", max: 5, windowMs: 60 * MINUTE },
  resetEmail: { name: "reset:email", max: 5, windowMs: 60 * MINUTE },
  resetIp: { name: "reset:ip", max: 20, windowMs: 60 * MINUTE },
  resetSubmit: { name: "reset:submit", max: 10, windowMs: 10 * MINUTE },
  inviteEmail: { name: "invite:email", max: 10, windowMs: 60 * MINUTE },
  inviteEmailTo: { name: "invite:to", max: 2, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, Limit>;

async function keyFor(limit: Limit, subject: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}\u0000${limit.name}\u0000${subject.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${limit.name}:${hex}`;
}

/**
 * Takes one slot if the limit allows it. A refused attempt is not recorded, so waiting is
 * enough to get back in and hammering does not extend the wait.
 */
export async function takeSlot(
  db: D1Database,
  limit: Limit,
  subject: string,
  salt: string,
  now: number = Date.now(),
): Promise<LimitResult> {
  const key = await keyFor(limit, subject, salt);
  const since = now - limit.windowMs;

  const res = await db
    .prepare(
      `insert into rate_hits (key, at)
       select ?1, ?2 where (select count(*) from rate_hits where key = ?1 and at > ?3) < ?4`,
    )
    .bind(key, now, since, limit.max)
    .run();
  if (res.meta.changes > 0) return { ok: true };

  const oldest = await db
    .prepare("select min(at) as at from rate_hits where key = ? and at > ?")
    .bind(key, since)
    .first<{ at: number | null }>();
  const freeAt = (oldest?.at ?? now) + limit.windowMs;
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((freeAt - now) / 1000)) };
}

/** Every limit must allow the attempt. Stops at the first refusal. */
async function takeAll(
  db: D1Database,
  checks: [Limit, string][],
  salt: string,
  now?: number,
): Promise<LimitResult> {
  for (const [limit, subject] of checks) {
    const result = await takeSlot(db, limit, subject, salt, now);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export const limitSignIn = (db: D1Database, salt: string, who: { ip: string; email: string }, now?: number) =>
  takeAll(db, [[LIMITS.signInIp, who.ip], [LIMITS.signInEmail, who.email.trim()]], salt, now);

export const limitSignUp = (db: D1Database, salt: string, who: { ip: string; inviteLinkId: string }, now?: number) =>
  takeAll(db, [[LIMITS.signUpIp, who.ip], [LIMITS.signUpLink, who.inviteLinkId]], salt, now);

/**
 * Per-person limits. The PRD sends likes to the approximate Workers Rate Limiting binding; until
 * that binding is set up they use the exact table too, which is correct, only heavier.
 */
export const limitPost = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.posts, userId, salt, now);

export const limitLike = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.likes, userId, salt, now);

export const limitRepost = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.reposts, userId, salt, now);

export const limitSave = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.saves, userId, salt, now);

export const limitFollow = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.follows, userId, salt, now);

/** Place suggestions (docs/PRD.md section 8.11): 40 a minute per person, so typing is free but a loop is not. */
export const limitPlaces = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.places, userId, salt, now);

/** Name suggestions while typing an @ (docs/PRD.md section 8.2): 120 a minute per person, so typing is free but a loop is not. */
export const limitMentions = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.mentions, userId, salt, now);

export const limitUpload = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.uploads, userId, salt, now);

export const limitTestEmail = (db: D1Database, salt: string, userId: string, now?: number) =>
  takeSlot(db, LIMITS.testEmail, userId, salt, now);

/** Asking for a reset link: per address and per visitor, so neither one inbox nor one visitor can be flooded. */
export const limitPasswordResetRequest = (db: D1Database, salt: string, who: { ip: string; email: string }, now?: number) =>
  takeAll(db, [[LIMITS.resetIp, who.ip], [LIMITS.resetEmail, who.email.trim()]], salt, now);

/** Trying to set a new password with a link: per visitor, so a link cannot be guessed at. */
export const limitPasswordResetSubmit = (db: D1Database, salt: string, ip: string, now?: number) =>
  takeSlot(db, LIMITS.resetSubmit, ip, salt, now);

/** An invite by email: a cap on what one member sends, and a cap on mail to one address from anyone. */
export const limitInviteEmail = (db: D1Database, salt: string, who: { userId: string; to: string }, now?: number) =>
  takeAll(db, [[LIMITS.inviteEmail, who.userId], [LIMITS.inviteEmailTo, who.to]], salt, now);

/** The visitor's address as Cloudflare reports it. Used only as a hashed, expiring limit key. */
export function clientIp(headers: Headers): string {
  return headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export function tooManyMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** Deletes hits that no window can still count. Called by the daily cron. */
export async function pruneRateHits(db: D1Database, olderThanMs: number = 24 * 60 * MINUTE, now: number = Date.now()) {
  const res = await db.prepare("delete from rate_hits where at < ?").bind(now - olderThanMs).run();
  return res.meta.changes;
}
