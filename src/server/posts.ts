// Posts, replies and likes (docs/PRD.md sections 8.2 and 8.3). Pages and actions call these;
// they never write SQL. Who may see what is always `visiblePosts`. A counter on a post changes
// in the same db.batch() as the row that causes it.

import { and, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { follows, likes, posts, profiles } from "@/db/schema";
import { isId, newId } from "@/lib/ids";
import { checkPostText } from "@/lib/post-text";
import { visiblePosts } from "@/server/visibility";

export const PAGE_SIZE = 20;

export type PostView = {
  id: string;
  body: string;
  createdAt: number;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  parentId: string | null;
  author: { userId: string; username: string; firstName: string; lastName: string; avatarKey: string | null };
};

export type Page = { items: PostView[]; nextCursor: string | null };

// ---- cursors: (milliseconds, id), newest first ----

export function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}_${id}`;
}

export function decodeCursor(raw: unknown): { createdAt: number; id: string } | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,15})_(post_[0-9A-Za-z]{24})$/.exec(raw);
  if (!match || !isId("post", match[2])) return null;
  return { createdAt: Number(match[1]), id: match[2] as string };
}

export function olderThan(cursor: { createdAt: number; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  const at = new Date(cursor.createdAt);
  return or(lt(posts.createdAt, at), and(eq(posts.createdAt, at), lt(posts.id, cursor.id)));
}

// ---- reading ----

export const postColumns = (viewerId: string) => ({
  id: posts.id,
  body: posts.body,
  createdAt: posts.createdAt,
  replyCount: posts.replyCount,
  likeCount: posts.likeCount,
  parentId: posts.parentId,
  liked: sql<number>`exists (select 1 from ${likes} where ${likes.postId} = ${posts.id} and ${likes.userId} = ${viewerId})`,
  userId: profiles.userId,
  username: profiles.username,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  avatarKey: profiles.avatarKey,
});

type Row = {
  id: string;
  body: string;
  createdAt: Date;
  replyCount: number;
  likeCount: number;
  parentId: string | null;
  liked: number;
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarKey: string | null;
};

const toView = (r: Row): PostView => ({
  id: r.id,
  body: r.body,
  createdAt: r.createdAt.getTime(),
  replyCount: r.replyCount,
  likeCount: r.likeCount,
  likedByMe: Boolean(r.liked),
  parentId: r.parentId,
  author: { userId: r.userId, username: r.username, firstName: r.firstName, lastName: r.lastName, avatarKey: r.avatarKey },
});

export function toPage(rows: Row[], limit: number): Page {
  const items = rows.slice(0, limit).map(toView);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/**
 * The home feed: top-level posts, newest first. `following` shows your own posts and those of
 * people you follow; `all` is every visible post (the ranked For you feed replaces it later).
 */
export async function listFeed(
  db: Db,
  viewerId: string,
  opts: { cursor?: unknown; limit?: number; scope?: "all" | "following" } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const fromFollowed =
    opts.scope === "following"
      ? or(
          eq(posts.authorId, viewerId),
          sql`${posts.authorId} in (select ${follows.followeeId} from ${follows} where ${follows.followerId} = ${viewerId})`,
        )
      : undefined;
  const rows = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), isNull(posts.parentId), fromFollowed, olderThan(decodeCursor(opts.cursor))))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

/** One person's posts (or, with `replies`, their replies), newest first. */
export async function listByAuthor(
  db: Db,
  viewerId: string,
  authorId: string,
  opts: { replies?: boolean; cursor?: unknown; limit?: number } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        visiblePosts(viewerId),
        eq(posts.authorId, authorId),
        opts.replies ? isNotNull(posts.parentId) : isNull(posts.parentId),
        olderThan(decodeCursor(opts.cursor)),
      ),
    )
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

/** One post, or null when it does not exist or this person may not see it. */
export async function getPost(db: Db, viewerId: string, postId: string): Promise<PostView | null> {
  if (!isId("post", postId)) return null;
  const row = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), eq(posts.id, postId)))
    .get();
  return row ? toView(row) : null;
}

/** Direct replies to a post, newest first. */
export async function listReplies(
  db: Db,
  viewerId: string,
  postId: string,
  opts: { cursor?: unknown; limit?: number } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), eq(posts.parentId, postId), olderThan(decodeCursor(opts.cursor))))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

// ---- writing ----

export type CreatePostResult =
  | { ok: true; id: string }
  | { ok: false; code: "empty" | "too_long" | "bad_characters" | "parent_not_found" };

const replyCountOf = (parentId: string) =>
  sql`(select count(*) from ${posts} as r where r.parent_id = ${parentId} and r.deleted_at is null)`;

/** Makes a post, or a reply when `parentId` is given. */
export async function createPost(db: Db, authorId: string, rawBody: unknown, parentId?: string): Promise<CreatePostResult> {
  const text = checkPostText(rawBody);
  if (!text.ok) return { ok: false, code: text.reason };

  if (parentId !== undefined && !(await getPost(db, authorId, parentId))) {
    return { ok: false, code: "parent_not_found" };
  }

  const id = newId("post");
  const insert = db.insert(posts).values({ id, authorId, parentId: parentId ?? null, body: text.text });
  if (parentId === undefined) {
    await insert;
  } else {
    // The reply and the parent's count change together.
    await db.batch([insert, db.update(posts).set({ replyCount: replyCountOf(parentId) }).where(eq(posts.id, parentId))]);
  }
  return { ok: true, id };
}

/** Deletes your own post. Anyone else's, or one that is already gone, is "not found". */
export async function deletePost(db: Db, userId: string, postId: string): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  if (!isId("post", postId)) return { ok: false, code: "not_found" };
  const post = await db
    .select({ parentId: posts.parentId })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, userId), isNull(posts.deletedAt)))
    .get();
  if (!post) return { ok: false, code: "not_found" };

  const hide = db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.authorId, userId), isNull(posts.deletedAt)));
  if (post.parentId) {
    const parentId = post.parentId;
    await db.batch([hide, db.update(posts).set({ replyCount: replyCountOf(parentId) }).where(eq(posts.id, parentId))]);
  } else {
    await hide;
  }
  return { ok: true };
}

/** Sets whether you like a post. Sending the wanted state twice changes nothing the second time. */
export async function setLike(
  db: Db,
  viewerId: string,
  postId: string,
  liked: boolean,
): Promise<{ ok: true; liked: boolean; likeCount: number } | { ok: false; code: "not_found" }> {
  const post = await getPost(db, viewerId, postId);
  if (!post) return { ok: false, code: "not_found" };

  const change = liked
    ? db.insert(likes).values({ userId: viewerId, postId }).onConflictDoNothing()
    : db.delete(likes).where(and(eq(likes.userId, viewerId), eq(likes.postId, postId)));
  // The row and the counter change in one batch; counting rows keeps the counter exact however often this runs.
  await db.batch([
    change,
    db.update(posts).set({ likeCount: sql`(select count(*) from ${likes} where ${likes.postId} = ${postId})` }).where(eq(posts.id, postId)),
  ]);

  const after = await db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId)).get();
  return { ok: true, liked, likeCount: after?.likeCount ?? 0 };
}
