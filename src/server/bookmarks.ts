// Bookmarks (docs/PRD.md section 8.9): private saves. Nobody sees another person's list, and no post
// shows a count. The list goes through `visiblePosts`, so a post that was deleted, or whose author went
// private or blocked you, is skipped.

import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "@/db";
import { bookmarks, posts, profiles } from "@/db/schema";
import { isId } from "@/lib/ids";
import { decodeCursor, getPost, PAGE_SIZE, pageOf, postColumns, type Page } from "@/server/posts";
import { visiblePosts } from "@/server/visibility";

export type BookmarkResult = { ok: true; saved: boolean } | { ok: false; code: "not_found" };

/**
 * Sets whether you have saved a post (the wanted state, not a flip). Saving needs a post you may see;
 * un-saving always works, so a post you can no longer see can still be dropped from your list.
 */
export async function setBookmark(db: Db, viewerId: string, postId: string, saved: boolean): Promise<BookmarkResult> {
  if (!isId("post", postId)) return { ok: false, code: "not_found" };
  if (saved) {
    if (!(await getPost(db, viewerId, postId))) return { ok: false, code: "not_found" };
    await db.insert(bookmarks).values({ userId: viewerId, postId }).onConflictDoNothing();
  } else {
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, viewerId), eq(bookmarks.postId, postId)));
  }
  return { ok: true, saved };
}

/** Your saved posts, newest saved first. The cursor is (when it was saved, post id). */
export async function listBookmarks(db: Db, viewerId: string, opts: { cursor?: unknown; limit?: number } = {}): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const at = cursor ? new Date(cursor.createdAt) : null;
  const rows = await db
    .select({ ...postColumns(viewerId), savedAt: bookmarks.createdAt })
    .from(bookmarks)
    .innerJoin(posts, eq(posts.id, bookmarks.postId))
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        eq(bookmarks.userId, viewerId),
        visiblePosts(viewerId),
        cursor && at ? or(lt(bookmarks.createdAt, at), and(eq(bookmarks.createdAt, at), lt(posts.id, cursor.id))) : undefined,
      ),
    )
    .orderBy(desc(bookmarks.createdAt), desc(posts.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit).map((row) => ({ row, at: row.savedAt.getTime(), by: null }));
  return pageOf(db, viewerId, entries, rows.length > limit);
}
