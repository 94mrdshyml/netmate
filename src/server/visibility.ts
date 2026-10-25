// The one rule for who may see what (CLAUDE.md hard rule 4, docs/PRD.md section 8.8). Every list of
// posts, the post page, replies, alerts about posts and a profile's own page use `personVisible`
// or `visiblePosts`; nothing re-implements them.
//
// You may see a person's content if it is yours, or if they are an active member, neither of you
// blocked the other, and they are public or you follow them. Mutes are not part of this: a muted
// person is still visible, only hidden from your home feed and alerts (`notMutedBy`).
//
// A post can also be for subscribers only (`posts.subscribers_of`, docs/PRD.md 8.14). Then it is seen by its
// creator and by people with a paid-up subscription to the creator (`hasSubscriberAccessSql`), and nobody else.
// `visiblePosts` leaves such a post out for everyone else; only a profile and the post page ask for it back, as a
// locked card with no words or pictures (`locked: true`, and `lockedFor` says which ones are locked).

import { and, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { LIVE_SUBSCRIPTION_STATUSES, posts } from "@/db/schema";
import { ACCESS_GRACE_MS } from "@/lib/subscription-access";

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

/**
 * A condition on any query: true when `viewerId` has a paid-up subscription to the person in `creatorId`, in the mode
 * the site is in now (a test-mode subscription gives nothing on a live site). Paid up means active or trialing, with a
 * period that has not ended more than `ACCESS_GRACE_MS` ago. `hasSubscriberAccess` asks this same question.
 */
export function hasSubscriberAccessSql(viewerId: Person | string, creatorId: Person | string, now: number = Date.now()): SQL {
  const live = sql.join(LIVE_SUBSCRIPTION_STATUSES.map((status) => sql`${status}`), sql`, `);
  return sql`exists (
    select 1 from subscriptions as sb
    where sb.subscriber_id = ${viewerId} and sb.creator_id = ${creatorId}
      and sb.mode = coalesce((select ps.mode from payment_settings as ps where ps.id = 'singleton'), 'sandbox')
      and sb.status in (${live})
      and (sb.current_period_end is null or sb.current_period_end > ${now - ACCESS_GRACE_MS}))`;
}

/** True for a post that is for everyone, or that `viewerId` wrote, or whose creator they are or pay. */
function unlocked(viewerId: string): SQL {
  return sql`(
    ${posts.subscribersOf} is null
    or ${posts.authorId} = ${viewerId}
    or ${posts.subscribersOf} = ${viewerId}
    or ${hasSubscriberAccessSql(viewerId, posts.subscribersOf)}
  )`;
}

/** A condition on a query that reads `posts`: true for a subscribers-only post `viewerId` may not read. */
export function lockedFor(viewerId: string): SQL {
  return sql`not ${unlocked(viewerId)}`;
}

/**
 * A condition on the `posts` table: true for the posts `viewerId` may see. With `locked`, posts that are for
 * subscribers only and that the viewer has no access to are let through as well, so a page can draw a locked card
 * (the row must then be treated with `lockedFor`: its words and pictures are never to be shown).
 */
export function visiblePosts(viewerId: string, opts: { locked?: boolean } = {}): SQL {
  return and(isNull(posts.deletedAt), personVisible(viewerId, posts.authorId), opts.locked ? undefined : unlocked(viewerId)) as SQL;
}

/** Asks the same question for one person, for pages that decide whether to show a list or a lock. */
export async function canSeeContentOf(db: Db, viewerId: string, personId: string): Promise<boolean> {
  const row = await db.get<{ ok: number }>(sql`select ${personVisible(viewerId, sql`${personId}`)} as ok`);
  return Boolean(row?.ok);
}
