// The one rule for which posts a person may see (CLAUDE.md hard rule 4). Every list of posts,
// the post page, replies and like checks use `visiblePosts`; nothing re-implements it.
// Today: not deleted, and the author is an active member. Private accounts, blocks and mutes
// are added here when they exist, and every caller picks them up.

import { and, isNull, sql, type SQL } from "drizzle-orm";
import { posts, profiles } from "@/db/schema";

/** A condition on the `posts` table: true for the posts `viewerId` may see. */
export function visiblePosts(viewerId: string): SQL {
  // viewerId is not used yet: the rules that need it (private accounts, blocks, mutes) come later.
  void viewerId;
  return and(
    isNull(posts.deletedAt),
    sql`exists (select 1 from ${profiles} where ${profiles.userId} = ${posts.authorId} and ${profiles.status} = 'active')`,
  ) as SQL;
}
