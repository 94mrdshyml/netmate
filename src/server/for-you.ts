// The ranked For you feed (docs/PRD.md section 8.3). SQL fetches simple candidate lists and counts; the score is
// worked out in TypeScript (`src/lib/feed-score.ts`, where every number is named). Who may see what is still only
// `visiblePosts` and `personVisible`: nothing here decides that. The member's own seen list (`post_seen`) is read for
// the member themself and nobody else.

import { and, desc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import { posts, profiles, reposts } from "@/db/schema";
import { FEED, rank, scorePost } from "@/lib/feed-score";
import { pageOf, postColumns, type Entry, type Page, type RepostedBy, type Row } from "@/server/posts";
import { notMutedBy, personVisible, visiblePosts } from "@/server/visibility";

const reposter = alias(profiles, "reposter");

/** `fy_<when the first page was made>_<how many entries came before this page>`. */
export function encodeForYouCursor(asOf: number, offset: number): string {
  return `fy_${asOf}_${offset}`;
}

/** The moment and offset, or null when it is not one of ours or is too old to keep (then the feed starts again). */
export function decodeForYouCursor(raw: unknown, now: number): { asOf: number; offset: number } | null {
  if (typeof raw !== "string") return null;
  const match = /^fy_(\d{1,15})_(\d{1,4})$/.exec(raw);
  if (!match) return null;
  const asOf = Number(match[1]);
  const offset = Number(match[2]);
  if (asOf > now || now - asOf > FEED.cursorMaxAgeMs || offset > FEED.poolMax * 3) return null;
  return { asOf, offset };
}

type Candidate = {
  row: Row;
  /** When it reached the reader: its own time, or the repost's. */
  at: number;
  by: RepostedBy | null;
  near: boolean;
};

type Scored = Candidate & { id: string; authorId: string; score: number };

/** A page of the For you feed, best first. A cursor from an earlier page keeps the ranking as it was made, so scrolling does not shuffle. */
export async function listForYou(db: Db, viewerId: string, opts: { cursor?: unknown; now?: number } = {}): Promise<Page> {
  const wall = opts.now ?? Date.now();
  const cursor = decodeForYouCursor(opts.cursor, wall);
  const asOf = cursor?.asOf ?? wall;
  const offset = cursor?.offset ?? 0;
  const since = asOf - FEED.windowMs;

  const followed = sql`select followee_id from follows where follower_id = ${viewerId}`;
  const inWindow = and(isNull(posts.parentId), gte(posts.createdAt, new Date(since)), lte(posts.createdAt, new Date(asOf)));
  const readable = and(visiblePosts(viewerId), notMutedBy(viewerId, posts.authorId));
  const friendEngaged = sql`(
    exists (select 1 from likes fl where fl.post_id = ${posts.id} and fl.user_id in (${followed}))
    or exists (select 1 from reposts fr where fr.post_id = ${posts.id} and fr.user_id in (${followed})))`;
  const strangers = and(sql`${posts.authorId} <> ${viewerId}`, sql`${posts.authorId} not in (${followed})`, isNull(posts.subscribersOf));

  const own = (extra?: SQL) =>
    db
      .select(postColumns(viewerId))
      .from(posts)
      .innerJoin(profiles, eq(profiles.userId, posts.authorId))
      .where(and(readable, inWindow, extra))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(FEED.poolMax);

  const [near, strangersWithTraction, repostRows] = await Promise.all([
    own(or(eq(posts.authorId, viewerId), sql`${posts.authorId} in (${followed})`)),
    // Strangers' public posts are let in only with traction: enough reactions in all, or one from someone the reader follows.
    own(and(strangers, sql`(${posts.likeCount} + ${posts.repostCount} + ${posts.replyCount} >= ${FEED.minTraction} or ${friendEngaged})`)),
    db
      .select({
        ...postColumns(viewerId),
        repostAt: reposts.createdAt,
        rUserId: reposter.userId,
        rUsername: reposter.username,
        rFirstName: reposter.firstName,
        rLastName: reposter.lastName,
      })
      .from(reposts)
      .innerJoin(posts, eq(posts.id, reposts.postId))
      .innerJoin(profiles, eq(profiles.userId, posts.authorId))
      .innerJoin(reposter, eq(reposter.userId, reposts.userId))
      .where(
        and(
          readable,
          isNull(posts.parentId),
          personVisible(viewerId, reposts.userId),
          notMutedBy(viewerId, reposts.userId),
          gte(reposts.createdAt, new Date(since)),
          lte(reposts.createdAt, new Date(asOf)),
          or(eq(reposts.userId, viewerId), sql`${reposts.userId} in (${followed})`),
        ),
      )
      .orderBy(desc(reposts.createdAt), desc(posts.id))
      .limit(FEED.poolMax),
  ]);

  const candidates: Candidate[] = [
    ...near.map((row) => ({ row, at: row.createdAt.getTime(), by: null, near: true })),
    ...repostRows.map((r) => ({
      row: r,
      at: r.repostAt.getTime(),
      by: { userId: r.rUserId, username: r.rUsername, firstName: r.rFirstName, lastName: r.rLastName },
      near: true,
    })),
    ...strangersWithTraction.map((row) => ({ row, at: row.createdAt.getTime(), by: null, near: false })),
  ];

  // A small instance: too few entries, so strangers' recent posts are let in without needing traction, and the feed is not empty.
  if (new Set(candidates.map((c) => c.row.id)).size < FEED.fillBelow) {
    const more = await own(strangers);
    candidates.push(...more.map((row) => ({ row, at: row.createdAt.getTime(), by: null, near: false })));
  }

  // What the reader has seen (as of the moment the first page was made), who they have lately reacted to, and which strangers' posts people they follow reacted to.
  const [seenRows, affinityRows, friendRows] = await Promise.all([
    db.all<{ post_id: string }>(sql`select post_id from post_seen where user_id = ${viewerId} and seen_at >= ${since} and seen_at <= ${asOf} limit 5000`),
    db.all<{ author_id: string; n: number }>(sql`
      select author_id, count(*) as n from (
        select p.author_id from likes l join posts p on p.id = l.post_id where l.user_id = ${viewerId} and l.created_at >= ${asOf - FEED.affinityWindowMs}
        union all select p.author_id from reposts r join posts p on p.id = r.post_id where r.user_id = ${viewerId} and r.created_at >= ${asOf - FEED.affinityWindowMs}
        union all select p.author_id from bookmarks b join posts p on p.id = b.post_id where b.user_id = ${viewerId} and b.created_at >= ${asOf - FEED.affinityWindowMs}
        union all select p.author_id from posts r join posts p on p.id = r.parent_id where r.author_id = ${viewerId} and r.created_at >= ${asOf - FEED.affinityWindowMs}
      ) group by author_id`),
    db.all<{ post_id: string; n: number }>(sql`
      select x.post_id as post_id, count(distinct x.user_id) as n
      from (select user_id, post_id from likes union all select user_id, post_id from reposts) x
      join posts p on p.id = x.post_id
      where x.user_id in (${followed}) and p.parent_id is null and p.created_at >= ${since}
      group by x.post_id`),
  ]);
  const seen = new Set(seenRows.map((r) => r.post_id));
  const affinity = new Map(affinityRows.map((r) => [r.author_id, r.n]));
  const friends = new Map(friendRows.map((r) => [r.post_id, r.n]));

  // One entry for each post: the best way it reached the reader (itself, or someone's repost).
  const best = new Map<string, Scored>();
  for (const c of candidates) {
    const r = c.row;
    const friendCount = friends.get(r.id) ?? 0;
    const score = scorePost({
      likes: r.likeCount,
      reposts: r.repostCount,
      replies: r.replyCount,
      reachedAt: c.at,
      now: asOf,
      near: c.near,
      affinity: affinity.get(r.userId) ?? 0,
      friends: friendCount,
      seen: seen.has(r.id),
    });
    const entry: Scored = { ...c, id: r.id, authorId: r.userId, score };
    const had = best.get(r.id);
    if (!had || entry.score > had.score) best.set(r.id, entry);
  }

  const ranked = rank([...best.values()]);
  const slice = ranked.slice(offset, offset + FEED.pageSize);
  const entries: Entry[] = slice.map((e) => ({ row: e.row, at: e.at, by: e.by }));
  const page = await pageOf(db, viewerId, entries, false);
  const items = page.items.map((item, i) => ({ ...item, suggested: !slice[i]!.near }));
  return { items, nextCursor: offset + FEED.pageSize < ranked.length ? encodeForYouCursor(asOf, offset + FEED.pageSize) : null };
}
