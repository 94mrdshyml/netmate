// What a member has seen, kept only to rank that member's own For you feed (docs/PRD.md section 8.3; CLAUDE.md rule 2).
// Written when the member's phone says half of a post was on screen for a second. Read only by `listForYou` for the same
// member. Never shown, counted, exported or compared between members. Rows older than the feed's window are removed
// each time anyone's phone reports a view, so nothing is kept longer than it could matter.

import { lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { postSeen, posts } from "@/db/schema";
import { FEED } from "@/lib/feed-score";
import { isId } from "@/lib/ids";
import { visiblePosts } from "@/server/visibility";

/** Most posts one report may carry (D1 allows 100 bound values in a statement). */
export const SEEN_BATCH_MAX = 40;

/**
 * Records that `viewerId` saw these posts. Only posts the viewer may see are kept (the one visibility rule), anything
 * that is not a post id is dropped, and repeating a report changes nothing. Returns how many ids were looked at.
 */
export async function markSeen(db: Db, viewerId: string, rawIds: unknown, now: number = Date.now()): Promise<number> {
  if (!Array.isArray(rawIds)) return 0;
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && isId("post", id)))].slice(0, SEEN_BATCH_MAX);
  if (ids.length === 0) return 0;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  await db.batch([
    db.delete(postSeen).where(lt(postSeen.seenAt, new Date(now - FEED.windowMs))),
    db
      .insert(postSeen)
      .select(sql`select ${viewerId}, ${posts.id}, ${now} from ${posts} where ${visiblePosts(viewerId)} and ${posts.id} in (${list})`)
      .onConflictDoNothing(),
  ]);
  return ids.length;
}
