// Posts, replies and likes (docs/PRD.md sections 8.2 and 8.3). Pages and actions call these;
// they never write SQL. Who may see what is always `visiblePosts`. A counter on a post changes
// in the same db.batch() as the row that causes it.

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { follows, likes, POST_PHOTO_MAX, postMedia, posts, profiles } from "@/db/schema";
import { isId, newId } from "@/lib/ids";
import { checkPostText } from "@/lib/post-text";
import { alertOnLike, alertOnReply, removeLikeAlert } from "@/server/notifications";
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
  /** Storage keys of the photos, in the order shown. Empty for a text-only post. */
  photos: string[];
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

// A post with photos and no words keeps one space as its text (the database wants 1 to 280
// characters); it is never shown.
const toView = (r: Row): PostView => ({
  id: r.id,
  body: r.body.trim(),
  createdAt: r.createdAt.getTime(),
  replyCount: r.replyCount,
  likeCount: r.likeCount,
  likedByMe: Boolean(r.liked),
  parentId: r.parentId,
  photos: [],
  author: { userId: r.userId, username: r.username, firstName: r.firstName, lastName: r.lastName, avatarKey: r.avatarKey },
});

/** Fills in the photos of every post in one query. */
async function withPhotos(db: Db, items: PostView[]): Promise<PostView[]> {
  if (items.length === 0) return items;
  const rows = await db
    .select({ postId: postMedia.postId, key: postMedia.key })
    .from(postMedia)
    .where(inArray(postMedia.postId, items.map((p) => p.id)))
    .orderBy(asc(postMedia.postId), asc(postMedia.position));
  const byPost = new Map<string, string[]>();
  for (const r of rows) byPost.set(r.postId, [...(byPost.get(r.postId) ?? []), r.key]);
  return items.map((p) => ({ ...p, photos: byPost.get(p.id) ?? [] }));
}

export async function toPage(db: Db, rows: Row[], limit: number): Promise<Page> {
  const items = await withPhotos(db, rows.slice(0, limit).map(toView));
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
  return toPage(db, rows, limit);
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
  return toPage(db, rows, limit);
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
  if (!row) return null;
  return (await withPhotos(db, [toView(row)]))[0] ?? null;
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
  return toPage(db, rows, limit);
}

// ---- writing ----

export type CreatePostResult =
  | { ok: true; id: string }
  | { ok: false; code: "empty" | "too_long" | "bad_characters" | "parent_not_found" | "bad_photos" };

const replyCountOf = (parentId: string) =>
  sql`(select count(*) from ${posts} as r where r.parent_id = ${parentId} and r.deleted_at is null)`;

/** True when every key is a distinct post photo this person uploaded, and there are at most four. */
export function photoKeysAreValid(authorId: string, keys: unknown): keys is string[] {
  if (!Array.isArray(keys) || keys.length > POST_PHOTO_MAX || new Set(keys).size !== keys.length) return false;
  const own = new RegExp(`^posts/${authorId}/[0-9A-Za-z]{24}\.(jpg|png|gif|webp)$`);
  return isId("user", authorId) && keys.every((k) => typeof k === "string" && own.test(k));
}

/**
 * Makes a post, or a reply when `parentId` is given. `photoKeys` are keys of pictures already
 * uploaded and checked by the caller (the action); this only checks they are this person's.
 */
export async function createPost(
  db: Db,
  authorId: string,
  rawBody: unknown,
  parentId?: string,
  photoKeys: string[] = [],
): Promise<CreatePostResult> {
  if (!photoKeysAreValid(authorId, photoKeys)) return { ok: false, code: "bad_photos" };
  // Photos can stand in for words; the text is then one space (see toView).
  const wordless = photoKeys.length > 0 && typeof rawBody === "string" && rawBody.trim() === "";
  const text = wordless ? ({ ok: true, text: " ", length: 1 } as const) : checkPostText(rawBody);
  if (!text.ok) return { ok: false, code: text.reason };

  if (parentId !== undefined && !(await getPost(db, authorId, parentId))) {
    return { ok: false, code: "parent_not_found" };
  }

  const id = newId("post");
  const insert = db.insert(posts).values({ id, authorId, parentId: parentId ?? null, body: text.text });
  const photos = photoKeys.map((key, position) => ({ postId: id, position, key }));
  if (parentId === undefined && photos.length === 0) {
    await insert;
  } else {
    // The post, its photos, and for a reply the parent's count and the parent's author's alert change together.
    await db.batch([
      insert,
      ...(photos.length > 0 ? [db.insert(postMedia).values(photos)] : []),
      ...(parentId === undefined
        ? []
        : [db.update(posts).set({ replyCount: replyCountOf(parentId) }).where(eq(posts.id, parentId)), alertOnReply(db, authorId, parentId, id)]),
    ] as unknown as Parameters<Db["batch"]>[0]);
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
    // The author's alert is added with the like and taken away with it.
    liked ? alertOnLike(db, viewerId, postId) : removeLikeAlert(db, viewerId, postId),
  ]);

  const after = await db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId)).get();
  return { ok: true, liked, likeCount: after?.likeCount ?? 0 };
}
