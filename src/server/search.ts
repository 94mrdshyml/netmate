// Search (docs/PRD.md section 8.6): posts and people through the FTS5 indexes, plus the people
// suggested when the box is empty. The index only finds candidates. What a person may see is
// still decided by `visiblePosts`, so deleted posts and posts from people who are not active
// never appear even if the index were out of date. Pages never write SQL.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { posts, profiles } from "@/db/schema";
import { buildSearchQuery } from "@/lib/search-query";
import type { PersonView } from "@/server/follows";
import { decodeCursor, olderThan, PAGE_SIZE, postColumns, toPage, type Page } from "@/server/posts";
import { visiblePosts } from "@/server/visibility";

export const PEOPLE_RESULTS = 20;
export const SUGGESTION_COUNT = 8;

/** Posts (replies included) whose text matches, newest first, paged by (time, id). */
export async function searchPosts(
  db: Db,
  viewerId: string,
  rawQuery: unknown,
  opts: { cursor?: unknown; limit?: number } = {},
): Promise<Page> {
  const query = buildSearchQuery(rawQuery);
  if (!query) return { items: [], nextCursor: null };
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        visiblePosts(viewerId),
        sql`${posts.id} in (select post_id from posts_fts where posts_fts match ${query.match})`,
        olderThan(decodeCursor(opts.cursor)),
      ),
    )
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

type PersonRow = {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  bio: string;
  avatar_key: string | null;
  i_follow: number;
};

const toPerson = (viewerId: string) => (r: PersonRow): PersonView => ({
  userId: r.user_id,
  username: r.username,
  firstName: r.first_name,
  lastName: r.last_name,
  bio: r.bio,
  avatarKey: r.avatar_key,
  iFollow: Boolean(r.i_follow),
  isMe: r.user_id === viewerId,
});

/**
 * Active members whose username or name starts with what was typed. An exact username comes
 * first, then usernames that start with the text, then the best text match. At most 20, not paged.
 */
export async function searchPeople(db: Db, viewerId: string, rawQuery: unknown): Promise<PersonView[]> {
  const query = buildSearchQuery(rawQuery);
  if (!query) return [];
  // Usernames are lower case letters, numbers and underscores. Compare by position, not LIKE,
  // because an underscore means "any character" to LIKE.
  const typed = query.terms.join(" ").toLowerCase();
  const rows = await db.all<PersonRow>(sql`
    select p.user_id, p.username, p.first_name, p.last_name, p.bio, p.avatar_key,
      exists (select 1 from follows f where f.follower_id = ${viewerId} and f.followee_id = p.user_id) as i_follow
    from profiles_fts
    join profiles p on p.user_id = profiles_fts.user_id
    where profiles_fts match ${query.match} and p.status = 'active'
    order by (p.username = ${typed}) desc,
      (substr(p.username, 1, length(${typed})) = ${typed}) desc,
      profiles_fts.rank,
      p.username
    limit ${PEOPLE_RESULTS}
  `);
  return rows.map(toPerson(viewerId));
}

/**
 * Who to show when nothing is typed: people followed by the people you follow (most shared
 * first), then the newest members. Never yourself, never someone you already follow.
 */
export async function suggestPeople(db: Db, viewerId: string, limit = SUGGESTION_COUNT): Promise<PersonView[]> {
  const rows = await db.all<PersonRow>(sql`
    select p.user_id, p.username, p.first_name, p.last_name, p.bio, p.avatar_key, 0 as i_follow
    from profiles p
    left join (
      select followee_id as user_id, count(*) as shared
      from follows
      where follower_id in (select followee_id from follows where follower_id = ${viewerId})
      group by followee_id
    ) s on s.user_id = p.user_id
    where p.status = 'active'
      and p.user_id <> ${viewerId}
      and p.user_id not in (select followee_id from follows where follower_id = ${viewerId})
    order by coalesce(s.shared, 0) desc, p.created_at desc, p.user_id desc
    limit ${limit}
  `);
  return rows.map(toPerson(viewerId));
}
