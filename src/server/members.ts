// The admin's view of the community (docs/PRD.md, "Members and numbers"): who is here, what they made, and
// who is a moderator. Counts only. Nothing here says who liked, saved or looked at whom, and saves are
// left out completely (bookmarks are private, CLAUDE.md hard rule 2).

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { profiles } from "@/db/schema";
import { isId } from "@/lib/ids";
import { decodePeopleCursor, encodePeopleCursor } from "@/server/follows";

export const MEMBER_PAGE = 25;
export const MEMBER_FILTERS = ["all", "moderators", "pending", "suspended"] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export type MemberCounts = {
  posts: number;
  replies: number;
  quotes: number;
  reposts: number;
  pictures: number;
  gifs: number;
  links: number;
  likesGiven: number;
  likesReceived: number;
  followers: number;
  following: number;
};

export type MemberRow = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  /** Only given to the admin. A moderator never sees an email address. */
  email: string | null;
  role: "admin" | "member";
  isModerator: boolean;
  status: "active" | "pending" | "suspended";
  isPrivate: boolean;
  joinedAt: number;
  invitedBy: string | null;
  counts: MemberCounts;
};

export type MemberPage = { items: MemberRow[]; nextCursor: string | null };

/** "%text%" for a LIKE with `escape '\'`: lower case, and the characters LIKE treats as wildcards taken literally. */
export function likePattern(raw: string): string {
  const text = Array.from(raw.trim().toLowerCase()).slice(0, 50).join("");
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type Raw = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isModerator: number;
  status: string;
  isPrivate: number;
  joinedAt: number;
  invitedBy: string | null;
} & MemberCounts;

/**
 * One page of members, newest first. `viewerIsAdmin` decides whether emails are included (and searchable).
 * `filter` narrows to moderators or to people still waiting for approval; `query` matches a name or username.
 */
export async function listMembers(
  db: Db,
  viewer: { isAdmin: boolean },
  opts: { query?: unknown; filter?: unknown; cursor?: unknown; limit?: number } = {},
): Promise<MemberPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? MEMBER_PAGE), 1), 100);
  const filter: MemberFilter = (MEMBER_FILTERS as readonly unknown[]).includes(opts.filter) ? (opts.filter as MemberFilter) : "all";
  const text = typeof opts.query === "string" ? opts.query.trim() : "";
  const cursor = decodePeopleCursor(opts.cursor);

  const pattern = likePattern(text);
  const search =
    text === ""
      ? sql``
      : sql`and (lower(p.username) like ${pattern} escape '\\'
                 or lower(p.first_name || ' ' || p.last_name) like ${pattern} escape '\\'
                 ${viewer.isAdmin ? sql`or lower(u.email) like ${pattern} escape '\\'` : sql``})`;
  const narrow =
    filter === "moderators"
      ? sql`and p.is_moderator = 1`
      : filter === "pending"
        ? sql`and p.status = 'pending'`
        : filter === "suspended"
          ? sql`and p.status = 'suspended'`
          : sql``;
  const after = cursor ? sql`and (p.created_at < ${cursor.createdAt} or (p.created_at = ${cursor.createdAt} and p.user_id < ${cursor.userId}))` : sql``;

  const rows = await db.all<Raw>(sql`
    select p.user_id as userId, p.username as username, p.first_name as firstName, p.last_name as lastName,
           u.email as email, p.role as role, p.is_moderator as isModerator, p.status as status,
           p.is_private as isPrivate, p.created_at as joinedAt,
           (select i.first_name || ' ' || i.last_name from profiles i where i.user_id = p.invited_by) as invitedBy,
           (select count(*) from posts x where x.author_id = p.user_id and x.deleted_at is null and x.parent_id is null and x.quoted_post_id is null) as posts,
           (select count(*) from posts x where x.author_id = p.user_id and x.deleted_at is null and x.parent_id is not null) as replies,
           (select count(*) from posts x where x.author_id = p.user_id and x.deleted_at is null and x.quoted_post_id is not null) as quotes,
           (select count(*) from reposts r where r.user_id = p.user_id) as reposts,
           (select count(*) from post_media m join posts x on x.id = m.post_id where x.author_id = p.user_id and x.deleted_at is null) as pictures,
           (select count(*) from post_gifs g join posts x on x.id = g.post_id where x.author_id = p.user_id and x.deleted_at is null) as gifs,
           (select count(*) from post_links l join posts x on x.id = l.post_id where x.author_id = p.user_id and x.deleted_at is null) as links,
           (select count(*) from likes k where k.user_id = p.user_id) as likesGiven,
           (select coalesce(sum(x.like_count), 0) from posts x where x.author_id = p.user_id and x.deleted_at is null) as likesReceived,
           (select count(*) from follows f where f.followee_id = p.user_id) as followers,
           (select count(*) from follows f where f.follower_id = p.user_id) as following
    from profiles p
    join user u on u.id = p.user_id
    where 1 = 1 ${narrow} ${search} ${after}
    order by p.created_at desc, p.user_id desc
    limit ${limit + 1}`);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      userId: r.userId,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
      email: viewer.isAdmin ? r.email : null,
      role: r.role === "admin" ? "admin" : "member",
      isModerator: r.role !== "admin" && r.isModerator === 1,
      status: r.status === "pending" ? "pending" : r.status === "suspended" ? "suspended" : "active",
      isPrivate: r.isPrivate === 1,
      joinedAt: r.joinedAt,
      invitedBy: r.invitedBy,
      counts: {
        posts: r.posts,
        replies: r.replies,
        quotes: r.quotes,
        reposts: r.reposts,
        pictures: r.pictures,
        gifs: r.gifs,
        links: r.links,
        likesGiven: r.likesGiven,
        likesReceived: r.likesReceived,
        followers: r.followers,
        following: r.following,
      },
    })),
    nextCursor: rows.length > limit && last ? encodePeopleCursor(last.joinedAt, last.userId) : null,
  };
}

// ---- Numbers for the whole community ----

export const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type SiteStats = {
  members: { active: number; pending: number; suspended: number; moderators: number; private: number };
  content: { posts: number; replies: number; quotes: number; reposts: number; pictures: number; gifs: number; links: number; places: number; removed: number };
  interactions: { likes: number; reposts: number; mentions: number; follows: number };
  /** Oldest first. Week 0 of the list is 7 weeks ago; the last entry is the last 7 days. */
  weeks: { newMembers: number; posts: number; replies: number; likes: number }[];
};

async function perWeek(db: Db, table: "profiles" | "posts_top" | "posts_replies" | "likes", now: number): Promise<number[]> {
  const from = now - WEEKS * WEEK_MS;
  const source =
    table === "profiles"
      ? sql`select created_at from profiles where status = 'active' and created_at > ${from}`
      : table === "likes"
        ? sql`select created_at from likes where created_at > ${from}`
        : table === "posts_top"
          ? sql`select created_at from posts where deleted_at is null and parent_id is null and quoted_post_id is null and created_at > ${from}`
          : sql`select created_at from posts where deleted_at is null and parent_id is not null and created_at > ${from}`;
  const rows = await db.all<{ w: number; n: number }>(sql`select cast((${now} - created_at) / ${WEEK_MS} as integer) as w, count(*) as n from (${source}) group by w`);
  const out = Array.from({ length: WEEKS }, () => 0);
  for (const r of rows) if (r.w >= 0 && r.w < WEEKS) out[WEEKS - 1 - r.w] = r.n;
  return out;
}

/** Totals for the community, and the last eight weeks. Counts only. */
export async function siteStats(db: Db, now: number = Date.now()): Promise<SiteStats> {
  const [one] = await db.all<Record<string, number>>(sql`
    select
      (select count(*) from profiles where status = 'active') as active,
      (select count(*) from profiles where status = 'pending') as pending,
      (select count(*) from profiles where status = 'suspended') as suspended,
      (select count(*) from profiles where is_moderator = 1 and role = 'member') as moderators,
      (select count(*) from profiles where is_private = 1 and status = 'active') as private,
      (select count(*) from posts where deleted_at is null and parent_id is null and quoted_post_id is null) as posts,
      (select count(*) from posts where deleted_at is null and parent_id is not null) as replies,
      (select count(*) from posts where deleted_at is null and quoted_post_id is not null) as quotes,
      (select count(*) from reposts) as reposts,
      (select count(*) from post_media m join posts x on x.id = m.post_id where x.deleted_at is null) as pictures,
      (select count(*) from post_gifs g join posts x on x.id = g.post_id where x.deleted_at is null) as gifs,
      (select count(*) from post_links l join posts x on x.id = l.post_id where x.deleted_at is null) as links,
      (select count(*) from posts where deleted_at is null and place is not null) as places,
      (select count(*) from posts where deleted_at is not null) as removed,
      (select count(*) from likes) as likes,
      (select count(*) from post_mentions) as mentions,
      (select count(*) from follows) as follows`);
  const n = one ?? {};
  const [newMembers, posts, replies, likes] = await Promise.all([perWeek(db, "profiles", now), perWeek(db, "posts_top", now), perWeek(db, "posts_replies", now), perWeek(db, "likes", now)]);
  return {
    members: { active: n.active ?? 0, pending: n.pending ?? 0, suspended: n.suspended ?? 0, moderators: n.moderators ?? 0, private: n.private ?? 0 },
    content: {
      posts: n.posts ?? 0,
      replies: n.replies ?? 0,
      quotes: n.quotes ?? 0,
      reposts: n.reposts ?? 0,
      pictures: n.pictures ?? 0,
      gifs: n.gifs ?? 0,
      links: n.links ?? 0,
      places: n.places ?? 0,
      removed: n.removed ?? 0,
    },
    interactions: { likes: n.likes ?? 0, reposts: n.reposts ?? 0, mentions: n.mentions ?? 0, follows: n.follows ?? 0 },
    weeks: Array.from({ length: WEEKS }, (_, i) => ({ newMembers: newMembers[i] ?? 0, posts: posts[i] ?? 0, replies: replies[i] ?? 0, likes: likes[i] ?? 0 })),
  };
}

// ---- Moderators ----

export type ModeratorResult = { ok: true; moderator: boolean } | { ok: false; code: "not_found" | "admin" | "pending" };

/**
 * Makes an active member a moderator, or takes it back. Send the state wanted: doing either twice changes
 * nothing. The admin is never a moderator, and someone still waiting for approval cannot become one.
 */
export async function setModerator(db: Db, userId: unknown, wanted: unknown): Promise<ModeratorResult> {
  if (!isId("user", userId) || typeof wanted !== "boolean") return { ok: false, code: "not_found" };
  const person = await db.select({ role: profiles.role, status: profiles.status }).from(profiles).where(eq(profiles.userId, userId)).get();
  if (!person) return { ok: false, code: "not_found" };
  if (person.role === "admin") return { ok: false, code: "admin" };
  if (wanted && person.status !== "active") return { ok: false, code: "pending" };
  await db.update(profiles).set({ isModerator: wanted }).where(eq(profiles.userId, userId));
  return { ok: true, moderator: wanted };
}
