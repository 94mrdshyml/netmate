// Privacy and safety (docs/PRD.md section 8.8): a private account and its follow requests, blocking
// and muting. Every change sends the wanted state, so repeating it changes nothing, and everything
// a change implies (a follow removed, an alert taken back) is written in the same db.batch().
// What a block or a private account means for what people see is decided in `visibility.ts`.

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { blocks, followRequests, follows, mutes, notifications, profiles } from "@/db/schema";
import { isId } from "@/lib/ids";
import { removeAlertsBetween, removeFollowRequestAlert } from "@/server/notifications";

/** How many blocked, muted or waiting people a screen lists (docs/PRD.md section 11). */
export const PRIVACY_LIST_MAX = 200;

export type ListedPerson = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  avatarKey: string | null;
};

const listedColumns = {
  userId: profiles.userId,
  username: profiles.username,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  bio: profiles.bio,
  avatarKey: profiles.avatarKey,
};

// ---- private account ----

export async function getPrivacy(db: Db, userId: string): Promise<{ isPrivate: boolean; waiting: number; blocked: number; muted: number }> {
  const row = await db.get<{ is_private: number; waiting: number; blocked: number; muted: number }>(sql`
    select
      (select is_private from profiles where user_id = ${userId}) as is_private,
      (select count(*) from follow_requests where target_id = ${userId}) as waiting,
      (select count(*) from blocks where blocker_id = ${userId}) as blocked,
      (select count(*) from mutes where muter_id = ${userId}) as muted`);
  return { isPrivate: Boolean(row?.is_private), waiting: row?.waiting ?? 0, blocked: row?.blocked ?? 0, muted: row?.muted ?? 0 };
}

/**
 * Turns your account private or public. Turning it public approves everyone who was waiting: they
 * become followers, and the requests and their alerts go, all in one batch.
 */
export async function setPrivate(db: Db, userId: string, wanted: boolean): Promise<void> {
  if (wanted) {
    await db.update(profiles).set({ isPrivate: true }).where(eq(profiles.userId, userId));
    return;
  }
  await db.batch([
    db.update(profiles).set({ isPrivate: false }).where(eq(profiles.userId, userId)),
    // The select supplies every column of `follows` in order (follower, followee, created).
    db
      .insert(follows)
      .select(sql`select requester_id, target_id, ${Date.now()} from follow_requests where target_id = ${userId}`)
      .onConflictDoNothing(),
    db.delete(followRequests).where(eq(followRequests.targetId, userId)),
    db.delete(notifications).where(and(eq(notifications.recipientId, userId), eq(notifications.type, "follow_request"))),
  ]);
}

// ---- follow requests ----

export type FollowRequestView = ListedPerson & { requestedAt: number };

/** Who is waiting for you to answer, oldest first. People who are not active members never show. */
export async function listFollowRequests(db: Db, userId: string): Promise<FollowRequestView[]> {
  const rows = await db
    .select({ ...listedColumns, requestedAt: followRequests.createdAt })
    .from(followRequests)
    .innerJoin(profiles, eq(profiles.userId, followRequests.requesterId))
    .where(and(eq(followRequests.targetId, userId), eq(profiles.status, "active")))
    .orderBy(followRequests.createdAt, followRequests.requesterId)
    .limit(PRIVACY_LIST_MAX);
  return rows.map((r) => ({ ...r, requestedAt: r.requestedAt.getTime() }));
}

/**
 * Approves or declines one request. Approving makes the person a follower; declining just removes
 * the request, and they are not told. Answering a request that is already gone changes nothing.
 */
export async function answerFollowRequest(
  db: Db,
  ownerId: string,
  requesterId: string,
  approve: boolean,
): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  if (!isId("user", requesterId)) return { ok: false, code: "not_found" };
  const pair = and(eq(followRequests.requesterId, requesterId), eq(followRequests.targetId, ownerId));
  const done = [db.delete(followRequests).where(pair), removeFollowRequestAlert(db, requesterId, ownerId)] as const;
  if (approve) {
    await db.batch([
      // Only while the request still exists, so a repeat adds nothing. The select supplies every
      // column of `follows` in order (follower, followee, created).
      db
        .insert(follows)
        .select(sql`select requester_id, target_id, ${Date.now()} from follow_requests where requester_id = ${requesterId} and target_id = ${ownerId}`)
        .onConflictDoNothing(),
      ...done,
    ]);
  } else {
    await db.batch([...done]);
  }
  return { ok: true };
}

// ---- block ----

/**
 * Blocks or unblocks someone. A block removes follows and waiting requests both ways and every
 * alert between the two, in the same batch. The other person is not told. Unblocking only
 * removes the block: the follows that were removed do not come back.
 */
export async function setBlock(
  db: Db,
  viewerId: string,
  targetId: string,
  wanted: boolean,
): Promise<{ ok: true; blocked: boolean } | { ok: false; code: "not_found" | "self" }> {
  if (viewerId === targetId) return { ok: false, code: "self" };
  if (!isId("user", targetId)) return { ok: false, code: "not_found" };

  if (!wanted) {
    await db.delete(blocks).where(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, targetId)));
    return { ok: true, blocked: false };
  }

  const target = await db
    .select({ one: profiles.userId })
    .from(profiles)
    .where(and(eq(profiles.userId, targetId), eq(profiles.status, "active")))
    .get();
  if (!target) return { ok: false, code: "not_found" };

  await db.batch([
    db.insert(blocks).values({ blockerId: viewerId, blockedId: targetId }).onConflictDoNothing(),
    db
      .delete(follows)
      .where(
        or(
          and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)),
          and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId)),
        ),
      ),
    db
      .delete(followRequests)
      .where(
        or(
          and(eq(followRequests.requesterId, viewerId), eq(followRequests.targetId, targetId)),
          and(eq(followRequests.requesterId, targetId), eq(followRequests.targetId, viewerId)),
        ),
      ),
    removeAlertsBetween(db, viewerId, targetId),
  ]);
  return { ok: true, blocked: true };
}

/** People you blocked, newest first, up to 200. */
export async function listBlocked(db: Db, viewerId: string): Promise<ListedPerson[]> {
  return db
    .select(listedColumns)
    .from(blocks)
    .innerJoin(profiles, eq(profiles.userId, blocks.blockedId))
    .where(eq(blocks.blockerId, viewerId))
    .orderBy(desc(blocks.createdAt), desc(blocks.blockedId))
    .limit(PRIVACY_LIST_MAX);
}

// ---- mute ----

/** Mutes or unmutes someone: they are hidden from your home feed and alerts. They are not told. */
export async function setMute(
  db: Db,
  viewerId: string,
  targetId: string,
  wanted: boolean,
): Promise<{ ok: true; muted: boolean } | { ok: false; code: "not_found" | "self" }> {
  if (viewerId === targetId) return { ok: false, code: "self" };
  if (!isId("user", targetId)) return { ok: false, code: "not_found" };

  if (!wanted) {
    await db.delete(mutes).where(and(eq(mutes.muterId, viewerId), eq(mutes.mutedId, targetId)));
    return { ok: true, muted: false };
  }

  const target = await db
    .select({ one: profiles.userId })
    .from(profiles)
    .where(and(eq(profiles.userId, targetId), eq(profiles.status, "active")))
    .get();
  if (!target) return { ok: false, code: "not_found" };

  await db.insert(mutes).values({ muterId: viewerId, mutedId: targetId }).onConflictDoNothing();
  return { ok: true, muted: true };
}

/** People you muted, newest first, up to 200. */
export async function listMuted(db: Db, viewerId: string): Promise<ListedPerson[]> {
  return db
    .select(listedColumns)
    .from(mutes)
    .innerJoin(profiles, eq(profiles.userId, mutes.mutedId))
    .where(eq(mutes.muterId, viewerId))
    .orderBy(desc(mutes.createdAt), desc(mutes.mutedId))
    .limit(PRIVACY_LIST_MAX);
}
