// The one rule for who may see what (CLAUDE.md hard rule 4, docs/PRD.md section 8.8). Every list of
// posts, the post page, replies, alerts about posts and a profile's own page use `personVisible`
// or `visiblePosts`; nothing re-implements them.
//
// You may see a person's content if it is yours, or if they are an active member, neither of you
// blocked the other, and they are public or you follow them. Mutes are not part of this: a muted
// person is still visible, only hidden from your home feed and alerts (`notMutedBy`).

import { and, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { posts } from "@/db/schema";

type Person = AnyColumn | SQL;

/** True when neither person has blocked the other. `personId` is a column or expression. */
export function notBlockedWith(viewerId: string, personId: Person): SQL {
  return sql`not exists (
    select 1 from blocks as bl
    where (bl.blocker_id = ${viewerId} and bl.blocked_id = ${personId})
       or (bl.blocker_id = ${personId} and bl.blocked_id = ${viewerId}))`;
}

/** True when `viewerId` has not muted the person. */
export function notMutedBy(viewerId: string, personId: Person): SQL {
  return sql`not exists (select 1 from mutes as mu where mu.muter_id = ${viewerId} and mu.muted_id = ${personId})`;
}

/** A condition on any query: true when `viewerId` may see the content of the person in `personId`. */
export function personVisible(viewerId: string, personId: Person): SQL {
  return sql`(
    ${personId} = ${viewerId}
    or (
      exists (
        select 1 from profiles as pv
        where pv.user_id = ${personId} and pv.status = 'active'
          and (pv.is_private = 0
               or exists (select 1 from follows as fv where fv.follower_id = ${viewerId} and fv.followee_id = pv.user_id)))
      and ${notBlockedWith(viewerId, personId)}
    )
  )`;
}

/** A condition on the `posts` table: true for the posts `viewerId` may see. */
export function visiblePosts(viewerId: string): SQL {
  return and(isNull(posts.deletedAt), personVisible(viewerId, posts.authorId)) as SQL;
}

/** Asks the same question for one person, for pages that decide whether to show a list or a lock. */
export async function canSeeContentOf(db: Db, viewerId: string, personId: string): Promise<boolean> {
  const row = await db.get<{ ok: number }>(sql`select ${personVisible(viewerId, sql`${personId}`)} as ok`);
  return Boolean(row?.ok);
}
