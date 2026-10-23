// Following people (docs/PRD.md sections 8.5 and 8.8). Follow and unfollow send the wanted state, so
// repeating them changes nothing. Following a private account sends a request instead; blocks
// stop a follow before it starts.

import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { followRequests, follows, profiles } from "@/db/schema";
import { isId } from "@/lib/ids";
import { alertOnFollow, alertOnFollowRequest, removeFollowAlert, removeFollowRequestAlert } from "@/server/notifications";
import { canSeeContentOf, notBlockedWith } from "@/server/visibility";

export const PEOPLE_PAGE_SIZE = 20;

export type PersonView = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  avatarKey: string | null;
  iFollow: boolean;
  /** You asked to follow this private account and are waiting. */
  requested: boolean;
  isMe: boolean;
};

export type PeoplePage = { items: PersonView[]; nextCursor: string | null };

export type FollowState = "none" | "following" | "requested";

export async function setFollow(
  db: Db,
  viewerId: string,
  targetId: string,
  wanted: boolean,
): Promise<{ ok: true; state: FollowState } | { ok: false; code: "not_found" | "self" }> {
  if (viewerId === targetId) return { ok: false, code: "self" };
  if (!isId("user", targetId)) return { ok: false, code: "not_found" };

  // Someone who is not an active member, or who blocked you or whom you blocked, is "not found".
  const target = await db
    .select({ isPrivate: profiles.isPrivate })
    .from(profiles)
    .where(and(eq(profiles.userId, targetId), eq(profiles.status, "active"), notBlockedWith(viewerId, profiles.userId)))
    .get();
  if (!target) return { ok: false, code: "not_found" };

  // Whatever is taken back, the follow, the request and their alerts go together.
  if (!wanted) {
    await db.batch([
      db.delete(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId))),
      db.delete(followRequests).where(and(eq(followRequests.requesterId, viewerId), eq(followRequests.targetId, targetId))),
      removeFollowAlert(db, viewerId, targetId),
      removeFollowRequestAlert(db, viewerId, targetId),
    ]);
    return { ok: true, state: "none" };
  }

  if (!target.isPrivate) {
    await db.batch([
      db.insert(follows).values({ followerId: viewerId, followeeId: targetId }).onConflictDoNothing(),
      alertOnFollow(db, viewerId, targetId),
    ]);
    return { ok: true, state: "following" };
  }

  // A private account: people who already follow stay followers; everyone else asks.
  const already = await db
    .select({ one: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)))
    .get();
  if (already) return { ok: true, state: "following" };
  await db.batch([
    db.insert(followRequests).values({ requesterId: viewerId, targetId }).onConflictDoNothing(),
    alertOnFollowRequest(db, viewerId, targetId),
  ]);
  return { ok: true, state: "requested" };
}

export function encodePeopleCursor(createdAt: number, userId: string): string {
  return `${createdAt}_${userId}`;
}

export function decodePeopleCursor(raw: unknown): { createdAt: number; userId: string } | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,15})_(usr_[0-9A-Za-z]{24})$/.exec(raw);
  return match ? { createdAt: Number(match[1]), userId: match[2] as string } : null;
}

/** Who follows `userId` (`followers`), or whom `userId` follows (`following`), newest first. */
export async function listPeople(
  db: Db,
  viewerId: string,
  userId: string,
  kind: "followers" | "following",
  opts: { cursor?: unknown; limit?: number } = {},
): Promise<PeoplePage> {
  const limit = opts.limit ?? PEOPLE_PAGE_SIZE;
  // A private account's lists are for its followers (and itself); a blocked pair see nothing of each other.
  if (!(await canSeeContentOf(db, viewerId, userId))) return { items: [], nextCursor: null };
  const cursor = decodePeopleCursor(opts.cursor);
  const mine = kind === "followers" ? follows.followeeId : follows.followerId;
  const theirs = kind === "followers" ? follows.followerId : follows.followeeId;
  const after = cursor
    ? or(
        lt(follows.createdAt, new Date(cursor.createdAt)),
        and(eq(follows.createdAt, new Date(cursor.createdAt)), lt(theirs, cursor.userId)),
      )
    : undefined;

  const rows = await db
    .select({
      createdAt: follows.createdAt,
      userId: profiles.userId,
      username: profiles.username,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      bio: profiles.bio,
      avatarKey: profiles.avatarKey,
      iFollow: sql<number>`exists (select 1 from ${follows} as mine where mine.follower_id = ${viewerId} and mine.followee_id = ${profiles.userId})`,
      requested: sql<number>`exists (select 1 from ${followRequests} as rq where rq.requester_id = ${viewerId} and rq.target_id = ${profiles.userId})`,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, theirs))
    .where(and(eq(mine, userId), eq(profiles.status, "active"), notBlockedWith(viewerId, profiles.userId), after))
    .orderBy(desc(follows.createdAt), desc(theirs))
    .limit(limit + 1);

  const items = rows.slice(0, limit).map((r) => ({
    userId: r.userId,
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    bio: r.bio,
    avatarKey: r.avatarKey,
    iFollow: Boolean(r.iFollow),
    requested: Boolean(r.requested),
    isMe: r.userId === viewerId,
  }));
  const lastRow = rows[limit - 1];
  return {
    items,
    nextCursor: rows.length > limit && lastRow ? encodePeopleCursor(lastRow.createdAt.getTime(), lastRow.userId) : null,
  };
}
