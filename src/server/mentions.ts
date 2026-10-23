// People to suggest while someone types an @name in the composer, and a check of which typed @names
// are real (docs/PRD.md section 8.2). Only active members, never yourself for a suggestion, and never
// anyone with a block either way with you. A private account can be mentioned (its header is visible
// to all), the same people search lists. Pages never write SQL.

import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { MENTIONS_PER_POST } from "@/lib/post-entities";
import { notBlockedWith } from "@/server/visibility";

export const MENTION_SUGGESTIONS = 6;

export type MentionCandidate = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarKey: string | null;
  iFollow: boolean;
};

type Row = { user_id: string; username: string; first_name: string; last_name: string; avatar_key: string | null; i_follow: number };

const toCandidate = (r: Row): MentionCandidate => ({
  userId: r.user_id,
  username: r.username,
  firstName: r.first_name,
  lastName: r.last_name,
  avatarKey: r.avatar_key,
  iFollow: Boolean(r.i_follow),
});

/** What a person types after the @: letters, numbers and underscores, at most the length of a username. */
export const MENTION_PREFIX = /^[a-z0-9_]{0,15}$/;

/**
 * Up to six people to suggest for what has been typed after an @. With nothing typed yet, the people
 * you follow (the most recently followed first), then the newest members. Otherwise people whose
 * username, first name or last name starts with it: an exact username first, then usernames, then
 * names, people you follow ahead of others. Compared by position, not LIKE, because an underscore
 * means "any character" to LIKE.
 */
export async function suggestMentions(db: Db, viewerId: string, rawPrefix: unknown): Promise<MentionCandidate[]> {
  if (typeof rawPrefix !== "string") return [];
  const typed = rawPrefix.toLowerCase();
  if (!MENTION_PREFIX.test(typed)) return [];
  const n = typed.length;
  const rows = await db.all<Row>(sql`
    select p.user_id, p.username, p.first_name, p.last_name, p.avatar_key,
      f.follower_id is not null as i_follow
    from profiles p
    left join follows f on f.follower_id = ${viewerId} and f.followee_id = p.user_id
    where p.status = 'active'
      and p.user_id <> ${viewerId}
      and ${notBlockedWith(viewerId, sql`p.user_id`)}
      and (${n} = 0
        or substr(p.username, 1, ${n}) = ${typed}
        or substr(lower(p.first_name), 1, ${n}) = ${typed}
        or substr(lower(p.last_name), 1, ${n}) = ${typed})
    order by (p.username = ${typed}) desc,
      (substr(p.username, 1, ${n}) = ${typed}) desc,
      (f.follower_id is not null) desc,
      f.created_at desc,
      p.created_at desc,
      p.username
    limit ${MENTION_SUGGESTIONS}
  `);
  return rows.map(toCandidate);
}

/**
 * Which of these typed usernames belong to a person who can be mentioned (an active member with no
 * block either way). At most ten are checked, the same cap as a post. Returns them lower-cased.
 */
export async function existingMentions(db: Db, viewerId: string, rawNames: unknown): Promise<string[]> {
  if (!Array.isArray(rawNames)) return [];
  const names = [...new Set(rawNames.filter((n): n is string => typeof n === "string").map((n) => n.toLowerCase()))]
    .filter((n) => /^[a-z0-9_]{3,15}$/.test(n))
    .slice(0, MENTIONS_PER_POST);
  if (names.length === 0) return [];
  const rows = await db.all<{ username: string }>(sql`
    select p.username from profiles p
    where p.status = 'active'
      and p.username in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
      and ${notBlockedWith(viewerId, sql`p.user_id`)}
  `);
  return rows.map((r) => r.username);
}
