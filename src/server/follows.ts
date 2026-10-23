// Following people (docs/PRD.md section 8.5). Follow and unfollow send the wanted state, so
// repeating them changes nothing. Private accounts and blocks join the same rules later.

import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { follows, profiles } from "@/db/schema";
import { isId } from "@/lib/ids";

export const PEOPLE_PAGE_SIZE = 20;

export type PersonView = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  iFollow: boolean;
  isMe: boolean;
};

export type PeoplePage = { items: PersonView[]; nextCursor: string | null };

export async function setFollow(
  db: Db,
  viewerId: string,
  targetId: string,
  wanted: boolean,
): Promise<{ ok: true; following: boolean } | { ok: false; code: "not_found" | "self" }> {
  if (viewerId === targetId) return { ok: false, code: "self" };
  if (!isId("user", targetId)) return { ok: false, code: "not_found" };

  const target = await db
    .select({ one: profiles.userId })
    .from(profiles)
    .where(and(eq(profiles.userId, targetId), eq(profiles.status, "active")))
    .get();
  if (!target) return { ok: false, code: "not_found" };

  if (wanted) {
    await db.insert(follows).values({ followerId: viewerId, followeeId: targetId }).onConflictDoNothing();
  } else {
    await db.delete(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)));
  }
  return { ok: true, following: wanted };
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
      iFollow: sql<number>`exists (select 1 from ${follows} as mine where mine.follower_id = ${viewerId} and mine.followee_id = ${profiles.userId})`,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, theirs))
    .where(and(eq(mine, userId), eq(profiles.status, "active"), after))
    .orderBy(desc(follows.createdAt), desc(theirs))
    .limit(limit + 1);

  const items = rows.slice(0, limit).map((r) => ({
    userId: r.userId,
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    bio: r.bio,
    iFollow: Boolean(r.iFollow),
    isMe: r.userId === viewerId,
  }));
  const lastRow = rows[limit - 1];
  return {
    items,
    nextCursor: rows.length > limit && lastRow ? encodePeopleCursor(lastRow.createdAt.getTime(), lastRow.userId) : null,
  };
}
