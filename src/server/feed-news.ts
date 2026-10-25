// "N new posts" on Home (docs/PRD.md section 8.3): how many top-level posts by people the reader follows were made since the
// page was drawn. Who may see what is still `visiblePosts`; people the reader muted are left out, as in the feed itself.

import { and, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { posts } from "@/db/schema";
import { FEED } from "@/lib/feed-score";
import { notMutedBy, visiblePosts } from "@/server/visibility";

/** The pill says "99+" above this, so counting stops here. */
export const NEW_POSTS_CAP = 99;

/** New posts since `since` (milliseconds) from people the reader follows. Not the reader's own posts. `since` is kept inside the feed's seven days. */
export async function countNewPosts(db: Db, viewerId: string, since: unknown, now: number = Date.now()): Promise<number> {
  const from = typeof since === "number" && Number.isFinite(since) ? Math.min(Math.max(since, now - FEED.windowMs), now) : now;
  const row = await db.get<{ n: number }>(sql`
    select count(*) as n from (
      select 1 from ${posts}
      where ${and(
        visiblePosts(viewerId),
        notMutedBy(viewerId, posts.authorId),
        isNull(posts.parentId),
        gt(posts.createdAt, new Date(from)),
        lte(posts.createdAt, new Date(now)),
        sql`${posts.authorId} in (select followee_id from follows where follower_id = ${viewerId})`,
      )}
      limit ${NEW_POSTS_CAP + 1}
    )`);
  return row?.n ?? 0;
}
