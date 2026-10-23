// Invite links (docs/PRD.md section 6). Each member has one reusable link; the code is long and
// random so it cannot be guessed, and it identifies the member it belongs to.

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { inviteLinks, profiles } from "@/db/schema";
import { newId, randomId } from "@/lib/ids";

export const INVITE_CODE_LENGTH = 32;

export type ActiveInvite = { id: string; code: string; ownerUserId: string };

/** The member's active link, made on first use. At most one active link per member (a database rule). */
export async function ensureInviteLink(db: Db, ownerUserId: string): Promise<ActiveInvite> {
  const find = () =>
    db
      .select({ id: inviteLinks.id, code: inviteLinks.code, ownerUserId: inviteLinks.ownerUserId })
      .from(inviteLinks)
      .where(and(eq(inviteLinks.ownerUserId, ownerUserId), isNull(inviteLinks.revokedAt)))
      .get();

  const existing = await find();
  if (existing) return existing;

  try {
    await db.insert(inviteLinks).values({ id: newId("inviteLink"), ownerUserId, code: randomId(INVITE_CODE_LENGTH) });
  } catch {
    // Two requests made a link at once: the one-active-link rule rejected the second. Use the winner.
  }
  const created = await find();
  if (!created) throw new Error("Could not create an invite link");
  return created;
}

export type InviteLookup = { id: string; ownerUserId: string; ownerName: string };

/** The active link for a code, with the name of the member who owns it. Null for unknown or revoked codes. */
export async function findActiveInvite(db: Db, code: unknown): Promise<InviteLookup | null> {
  if (typeof code !== "string" || code.length !== INVITE_CODE_LENGTH) return null;
  const row = await db
    .select({
      id: inviteLinks.id,
      ownerUserId: inviteLinks.ownerUserId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      status: profiles.status,
    })
    .from(inviteLinks)
    .innerJoin(profiles, eq(profiles.userId, inviteLinks.ownerUserId))
    .where(and(eq(inviteLinks.code, code), isNull(inviteLinks.revokedAt)))
    .get();
  if (!row || row.status !== "active") return null;
  return { id: row.id, ownerUserId: row.ownerUserId, ownerName: `${row.firstName} ${row.lastName}` };
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/sign-up?invite=${code}`;
}
