// Admin-only domain logic behind /hq (docs/PRD.md sections 6 and 8.12). Nothing here checks who is
// asking: the page or action calls requireAdmin() first (src/auth/admin.ts).

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { inviteLinks, instance, profiles, user } from "@/db/schema";
import { newId, randomId } from "@/lib/ids";
import { INVITE_CODE_LENGTH } from "@/server/invites";
import { removePendingApprovalAlert } from "@/server/notifications";

export type PendingPerson = {
  userId: string;
  name: string;
  username: string;
  email: string;
  createdAt: number;
  invitedByName: string | null;
};

export async function countPending(db: Db): Promise<number> {
  const row = await db.select({ n: sql<number>`count(*)` }).from(profiles).where(eq(profiles.status, "pending")).get();
  return row?.n ?? 0;
}

export async function countMembers(db: Db): Promise<number> {
  const row = await db.select({ n: sql<number>`count(*)` }).from(profiles).where(eq(profiles.status, "active")).get();
  return row?.n ?? 0;
}

/** Sign-ups waiting for the admin, oldest first (first come, first answered). */
export async function listPending(db: Db): Promise<PendingPerson[]> {
  const rows = await db.all<{
    userId: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    createdAt: number;
    inviterFirst: string | null;
    inviterLast: string | null;
  }>(sql`
    select p.user_id as userId, p.first_name as firstName, p.last_name as lastName, p.username as username,
           u.email as email, p.created_at as createdAt,
           i.first_name as inviterFirst, i.last_name as inviterLast
    from profiles p
    join user u on u.id = p.user_id
    left join profiles i on i.user_id = p.invited_by
    where p.status = 'pending'
    order by p.created_at asc, p.user_id asc
    limit 200`);
  return rows.map((r) => ({
    userId: r.userId,
    name: `${r.firstName} ${r.lastName}`,
    username: r.username,
    email: r.email,
    createdAt: r.createdAt,
    invitedByName: r.inviterFirst ? `${r.inviterFirst} ${r.inviterLast ?? ""}`.trim() : null,
  }));
}

export type Decision = { ok: true } | { ok: false; code: "not_pending" };

/** Pending becomes a member. Only a Pending person can be approved; the update is conditional, so a repeat does nothing. */
export async function approvePending(db: Db, userId: string): Promise<Decision> {
  // Once decided, the admin's "waiting for approval" alert for this person goes away.
  const [res] = await db.batch([
    db
      .update(profiles)
      .set({ status: "active" })
      .where(and(eq(profiles.userId, userId), eq(profiles.status, "pending")))
      .returning({ id: profiles.userId }),
    removePendingApprovalAlert(db, userId),
  ]);
  return res.length > 0 ? { ok: true } : { ok: false, code: "not_pending" };
}

/**
 * Rejecting deletes the account, so the email and username can be used again. Only a Pending person
 * can be rejected: an active member is never deleted from here. The link's count is not touched
 * (a rejected sign-up does not free a slot).
 */
export async function rejectPending(db: Db, userId: string): Promise<Decision> {
  const res = await db
    .delete(user)
    .where(and(eq(user.id, userId), sql`${user.id} in (select ${profiles.userId} from ${profiles} where ${profiles.status} = 'pending')`))
    .returning({ id: user.id });
  return res.length > 0 ? { ok: true } : { ok: false, code: "not_pending" };
}

export type InviteRow = {
  linkId: string;
  code: string;
  ownerUserId: string;
  ownerName: string;
  ownerUsername: string;
  isAdmin: boolean;
  usesCount: number;
  createdAt: number;
};

/** Every active link: the admin's first, then members by name. */
export async function listInviteLinks(db: Db): Promise<InviteRow[]> {
  const rows = await db
    .select({
      linkId: inviteLinks.id,
      code: inviteLinks.code,
      ownerUserId: inviteLinks.ownerUserId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      username: profiles.username,
      role: profiles.role,
      usesCount: inviteLinks.usesCount,
      createdAt: inviteLinks.createdAt,
    })
    .from(inviteLinks)
    .innerJoin(profiles, eq(profiles.userId, inviteLinks.ownerUserId))
    .where(and(isNull(inviteLinks.revokedAt), eq(profiles.status, "active")))
    .orderBy(desc(sql`${profiles.role} = 'admin'`), asc(profiles.firstName), asc(profiles.lastName), asc(inviteLinks.id))
    .limit(500);
  return rows.map((r) => ({
    linkId: r.linkId,
    code: r.code,
    ownerUserId: r.ownerUserId,
    ownerName: `${r.firstName} ${r.lastName}`,
    ownerUsername: r.username,
    isAdmin: r.role === "admin",
    usesCount: r.usesCount,
    createdAt: r.createdAt.getTime(),
  }));
}

/**
 * Replaces a member's link with a new code (for a leaked link). The old code stops working at once;
 * accounts already made through it are untouched. The sign-up count carries over to the new link,
 * so regenerating cannot be used to hand out a fresh quota. One atomic batch: if two admins click
 * at the same moment, only one new link is made.
 */
export async function regenerateInvite(db: Db, d1: D1Database, linkId: string): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  const old = await db
    .select({ id: inviteLinks.id, ownerUserId: inviteLinks.ownerUserId })
    .from(inviteLinks)
    .where(and(eq(inviteLinks.id, linkId), isNull(inviteLinks.revokedAt)))
    .get();
  if (!old) return { ok: false, code: "not_found" };

  const now = Date.now();
  try {
    const results = await d1.batch([
      d1.prepare("update invite_links set revoked_at = ?2 where id = ?1 and revoked_at is null").bind(old.id, now),
      // changes() is the row count of the update just above: only the request that really revoked the
      // link makes the new one, even when two requests share the same millisecond.
      d1
        .prepare(
          `insert into invite_links (id, owner_user_id, code, uses_count, created_at)
           select ?2, owner_user_id, ?3, uses_count, ?4 from invite_links where id = ?1 and revoked_at = ?4 and changes() = 1`,
        )
        .bind(old.id, newId("inviteLink"), randomId(INVITE_CODE_LENGTH), now),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0 ? { ok: true } : { ok: false, code: "not_found" };
  } catch {
    // The one-active-link rule refused a second new link: someone else replaced it first.
    return { ok: false, code: "not_found" };
  }
}

export const MAX_INVITE_QUOTA = 1000;

/** Sets how many sign-ups each member link auto-approves. A whole number from 0 to 1000. */
export async function setInviteQuota(db: Db, raw: unknown): Promise<{ ok: true; quota: number } | { ok: false; message: string }> {
  const text = typeof raw === "string" ? raw.trim() : raw;
  const n = typeof text === "string" ? (/^\d{1,4}$/.test(text) ? Number(text) : NaN) : typeof text === "number" ? text : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_INVITE_QUOTA) {
    return { ok: false, message: `Use a whole number from 0 to ${MAX_INVITE_QUOTA}.` };
  }
  await db.update(instance).set({ inviteQuota: n, updatedAt: new Date() }).where(eq(instance.id, "singleton"));
  return { ok: true, quota: n };
}

/** Turns place suggestions on or off for the whole instance. Sending the wanted state twice changes nothing. */
export async function setPlacesEnabled(db: Db, wanted: unknown): Promise<{ ok: true; enabled: boolean } | { ok: false; message: string }> {
  if (typeof wanted !== "boolean") return { ok: false, message: "Choose on or off." };
  await db.update(instance).set({ placesEnabled: wanted, updatedAt: new Date() }).where(eq(instance.id, "singleton"));
  return { ok: true, enabled: wanted };
}
