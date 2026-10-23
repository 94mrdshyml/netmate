// What the invite welcome screen shows a visitor who opened a valid invite link
// (docs/PRD.md section 6): who invited them and a few members who are already here.
// The visitor has no account yet, so only first names and pictures are used, only for people
// whose account is active and not private. The inviter is always first: their name is on the
// screen anyway.

import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import type { InviteLookup } from "@/server/invites";

export const WELCOME_FACES = 4;
export const WELCOME_NAMES = 3;

export type WelcomePerson = { userId: string; avatarKey: string | null; firstName: string };

export type InviteWelcome = {
  inviterFirstName: string;
  /** The inviter first, then others, at most WELCOME_FACES in all. */
  faces: WelcomePerson[];
  /** First names to say out loud (the first WELCOME_NAMES faces). */
  names: string[];
  /** Active members beyond the names, so the line can say "and 12 others". */
  others: number;
};

export async function inviteWelcome(db: Db, invite: Pick<InviteLookup, "ownerUserId">): Promise<InviteWelcome | null> {
  const inviter = await db.all<{ userId: string; avatarKey: string | null; firstName: string }>(sql`
    select user_id as userId, avatar_key as avatarKey, first_name as firstName
    from profiles where user_id = ${invite.ownerUserId} and status = 'active'`);
  const first = inviter[0];
  if (!first) return null;

  const rest = await db.all<{ userId: string; avatarKey: string | null; firstName: string }>(sql`
    select user_id as userId, avatar_key as avatarKey, first_name as firstName
    from profiles
    where status = 'active' and is_private = 0 and user_id <> ${invite.ownerUserId}
    order by created_at asc, user_id asc
    limit ${WELCOME_FACES - 1}`);
  const total = await db.all<{ n: number }>(sql`select count(*) as n from profiles where status = 'active'`);

  const faces = [first, ...rest];
  const names = faces.slice(0, WELCOME_NAMES).map((p) => p.firstName);
  return {
    inviterFirstName: first.firstName,
    faces,
    names,
    others: Math.max(0, (total[0]?.n ?? 0) - names.length),
  };
}
