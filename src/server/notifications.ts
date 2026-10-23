// Alerts (docs/PRD.md section 8.7). An alert is written in the same db.batch() as the like, follow,
// reply or sign-up that causes it, and removed in the batch that undoes it, so the two never
// disagree. The `alertOn...` functions return statements for the caller's batch; they write
// nothing by themselves. Reading goes through `visiblePosts`, like every list of posts.

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import { notifications, posts, profiles, type NotificationType } from "@/db/schema";
import { GROUPED_TYPES } from "@/lib/alert-text";
import { isId, newId } from "@/lib/ids";
import { notBlockedWith, notMutedBy, visiblePosts } from "@/server/visibility";

export const ALERTS_PAGE_SIZE = 30;

// ---- writing: statements for the caller's batch ----

// Each insert is "on conflict do nothing", so sending the same thing twice leaves one alert. It is
// not "or ignore", which would also hide a refused row (a bad type, or an alert about yourself).
// (drizzle's db.run() cannot join a D1 batch, so the two that need a select use insert().select().)

/**
 * Someone liked a post. Nothing is written for a like on your own post. The select supplies every
 * column of the table, in order (id, recipient, actor, type, post, created, read).
 */
export function alertOnLike(db: Db, actorId: string, postId: string) {
  return db
    .insert(notifications)
    .select(
      sql`select ${newId("notification")}, p.author_id, ${actorId}, 'like', p.id, ${Date.now()}, null
          from ${posts} p where p.id = ${postId} and p.author_id <> ${actorId}`,
    )
    .onConflictDoNothing();
}

/** The like was taken back, so its alert goes too. */
export function removeLikeAlert(db: Db, actorId: string, postId: string) {
  return db.delete(notifications).where(and(eq(notifications.actorId, actorId), eq(notifications.type, "like"), eq(notifications.postId, postId)));
}

/** Someone reposted a post. Nothing is written for a repost of your own post. */
export function alertOnRepost(db: Db, actorId: string, postId: string) {
  return db
    .insert(notifications)
    .select(
      sql`select ${newId("notification")}, p.author_id, ${actorId}, 'repost', p.id, ${Date.now()}, null
          from ${posts} p where p.id = ${postId} and p.author_id <> ${actorId}`,
    )
    .onConflictDoNothing();
}

/** The repost was taken back, so its alert goes too. */
export function removeRepostAlert(db: Db, actorId: string, postId: string) {
  return db.delete(notifications).where(and(eq(notifications.actorId, actorId), eq(notifications.type, "repost"), eq(notifications.postId, postId)));
}

/** `quoteId` quotes `quotedId`. The author of the quoted post hears about it (the alert points at the new post), unless it is the quoter. */
export function alertOnQuote(db: Db, actorId: string, quotedId: string, quoteId: string) {
  return db
    .insert(notifications)
    .select(
      sql`select ${newId("notification")}, p.author_id, ${actorId}, 'quote', ${quoteId}, ${Date.now()}, null
          from ${posts} p where p.id = ${quotedId} and p.author_id <> ${actorId}`,
    )
    .onConflictDoNothing();
}

/** Someone followed `targetId`. */
export function alertOnFollow(db: Db, actorId: string, targetId: string) {
  return db
    .insert(notifications)
    .values({ id: newId("notification"), recipientId: targetId, actorId, type: "follow" })
    .onConflictDoNothing();
}

/** The follow was taken back, so its alert goes too. */
export function removeFollowAlert(db: Db, actorId: string, targetId: string) {
  return db
    .delete(notifications)
    .where(and(eq(notifications.actorId, actorId), eq(notifications.recipientId, targetId), eq(notifications.type, "follow")));
}

/** Someone asked to follow the private account `targetId`. */
export function alertOnFollowRequest(db: Db, actorId: string, targetId: string) {
  return db
    .insert(notifications)
    .values({ id: newId("notification"), recipientId: targetId, actorId, type: "follow_request" })
    .onConflictDoNothing();
}

/** The request was answered or taken back, so its alert goes too. */
export function removeFollowRequestAlert(db: Db, actorId: string, targetId: string) {
  return db
    .delete(notifications)
    .where(and(eq(notifications.actorId, actorId), eq(notifications.recipientId, targetId), eq(notifications.type, "follow_request")));
}

/** Every alert either of two people caused for the other. A block takes them all away. */
export function removeAlertsBetween(db: Db, a: string, b: string) {
  return db
    .delete(notifications)
    .where(
      or(
        and(eq(notifications.recipientId, a), eq(notifications.actorId, b)),
        and(eq(notifications.recipientId, b), eq(notifications.actorId, a)),
      ),
    );
}

/** `replyId` is a reply to `parentId`. The author of the parent hears about it, unless it is the replier. */
export function alertOnReply(db: Db, actorId: string, parentId: string, replyId: string) {
  return db
    .insert(notifications)
    .select(
      sql`select ${newId("notification")}, p.author_id, ${actorId}, 'reply', ${replyId}, ${Date.now()}, null
          from ${posts} p where p.id = ${parentId} and p.author_id <> ${actorId}`,
    )
    .onConflictDoNothing();
}

/** The admin no longer has to decide about this person (approved). Rejecting deletes the account, which removes it too. */
export function removePendingApprovalAlert(db: Db, personId: string) {
  return db.delete(notifications).where(and(eq(notifications.actorId, personId), eq(notifications.type, "pending_approval")));
}

// ---- reading ----

export type AlertActor = { userId: string; username: string; firstName: string; lastName: string; avatarKey: string | null; active: boolean };

export type AlertItem = {
  /** Stable key for the row: the alert id, or the type and post for a group. */
  key: string;
  type: NotificationType;
  createdAt: number;
  unread: boolean;
  /** Everyone in the group, newest first, up to `SHOWN_ACTORS`. */
  actors: AlertActor[];
  /** How many people did it (more than `actors` when a group is large). */
  count: number;
  post: { id: string; body: string; authorUsername: string } | null;
};

export type AlertPage = { items: AlertItem[]; nextCursor: string | null };

export const SHOWN_ACTORS = 3;

const postAuthor = alias(profiles, "post_author");

/**
 * An alert about a post is shown only while that post is visible to the reader. No alert is shown
 * from someone you blocked, who blocked you, or whom you muted.
 */
const shown = (viewerId: string) =>
  and(
    or(isNull(notifications.postId), visiblePosts(viewerId)),
    notBlockedWith(viewerId, notifications.actorId),
    notMutedBy(viewerId, notifications.actorId),
  );

function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}_${id}`;
}

function decodeCursor(raw: unknown): { createdAt: number; id: string } | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,15})_(ntf_[0-9A-Za-z]{24})$/.exec(raw);
  return match && isId("notification", match[2]) ? { createdAt: Number(match[1]), id: match[2] as string } : null;
}

/** Newest first, 30 alerts per page. Likes (and later reposts) of one post collapse into one item within the page. */
export async function listAlerts(db: Db, viewerId: string, opts: { cursor?: unknown; limit?: number } = {}): Promise<AlertPage> {
  const limit = opts.limit ?? ALERTS_PAGE_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const older = cursor
    ? or(
        lt(notifications.createdAt, new Date(cursor.createdAt)),
        and(eq(notifications.createdAt, new Date(cursor.createdAt)), lt(notifications.id, cursor.id)),
      )
    : undefined;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      postId: notifications.postId,
      postBody: posts.body,
      postAuthorUsername: postAuthor.username,
      userId: profiles.userId,
      username: profiles.username,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      avatarKey: profiles.avatarKey,
      status: profiles.status,
    })
    .from(notifications)
    .innerJoin(profiles, eq(profiles.userId, notifications.actorId))
    .leftJoin(posts, eq(posts.id, notifications.postId))
    .leftJoin(postAuthor, eq(postAuthor.userId, posts.authorId))
    .where(and(eq(notifications.recipientId, viewerId), shown(viewerId), older))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const items: AlertItem[] = [];
  const groups = new Map<string, AlertItem>();
  for (const r of page) {
    const type = r.type as NotificationType;
    const actor: AlertActor = {
      userId: r.userId,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
      avatarKey: r.avatarKey,
      active: r.status === "active",
    };
    const post = r.postId && r.postBody !== null && r.postAuthorUsername ? { id: r.postId, body: r.postBody, authorUsername: r.postAuthorUsername } : null;
    const groupKey = GROUPED_TYPES.has(type) && r.postId ? `${type}:${r.postId}` : null;
    const existing = groupKey ? groups.get(groupKey) : undefined;
    if (existing) {
      existing.count += 1;
      existing.unread ||= r.readAt === null;
      if (existing.actors.length < SHOWN_ACTORS) existing.actors.push(actor);
      continue;
    }
    const item: AlertItem = { key: groupKey ?? r.id, type, createdAt: r.createdAt.getTime(), unread: r.readAt === null, actors: [actor], count: 1, post };
    items.push(item);
    if (groupKey) groups.set(groupKey, item);
  }

  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt.getTime(), last.id) : null };
}

/** How many unread alerts are waiting. Counts only the alerts the list would show. */
export async function countUnreadAlerts(db: Db, viewerId: string): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .leftJoin(posts, eq(posts.id, notifications.postId))
    .where(and(eq(notifications.recipientId, viewerId), isNull(notifications.readAt), shown(viewerId)))
    .get();
  return row?.n ?? 0;
}

/** Opening the screen marks everything read. Repeating it changes nothing. */
export async function markAllAlertsRead(db: Db, viewerId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, viewerId), isNull(notifications.readAt)));
}
