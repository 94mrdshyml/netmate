// Profiles (docs/PRD.md section 8.4): reading one, and editing your own.

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { blocks, followRequests, follows, mutes, posts, profiles, user } from "@/db/schema";
import { LINK_MAX, normalizeLink } from "@/lib/link";
import { normalizeUsername } from "@/lib/username";
import { personVisible } from "@/server/visibility";
import { isAttachable, removePicture } from "@/storage/upload";

export type ProfileView = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  link: string | null;
  location: string | null;
  avatarKey: string | null;
  bannerKey: string | null;
  joinedAt: number;
  followerCount: number;
  followingCount: number;
  /**
   * How many posts they have made: top-level posts that are not deleted, the ones on the Posts tab
   * (replies are on their own tab and are not counted). Null when you may not see their content (a
   * private account you do not follow, or a block), so the number does not give away how active it is.
   */
  postCount: number | null;
  iFollow: boolean;
  /** You asked to follow this private account and are waiting. */
  requested: boolean;
  isPrivate: boolean;
  /** You blocked them, they blocked you, and you muted them (docs/PRD.md section 8.8). */
  blockedByMe: boolean;
  blockedMe: boolean;
  mutedByMe: boolean;
  /** The one visibility rule for this person: false for a private account you do not follow, and for a block. */
  canSeeContent: boolean;
  isMe: boolean;
  /** People you follow who follow this person: a few names, and how many in all. */
  mates: { names: string[]; total: number };
};

const MATE_NAMES = 3;

/** A profile by @username, or null when there is no such active member. */
export async function getProfile(db: Db, viewerId: string, username: string): Promise<ProfileView | null> {
  const row = await db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      bio: profiles.bio,
      link: profiles.link,
      location: profiles.location,
      avatarKey: profiles.avatarKey,
      bannerKey: profiles.bannerKey,
      joinedAt: profiles.createdAt,
      followerCount: sql<number>`(select count(*) from ${follows} where ${follows.followeeId} = ${profiles.userId})`,
      followingCount: sql<number>`(select count(*) from ${follows} where ${follows.followerId} = ${profiles.userId})`,
      postCount: sql<number>`(select count(*) from ${posts} where ${posts.authorId} = ${profiles.userId} and ${posts.parentId} is null and ${posts.deletedAt} is null)`,
      iFollow: sql<number>`exists (select 1 from ${follows} as v where v.follower_id = ${viewerId} and v.followee_id = ${profiles.userId})`,
      requested: sql<number>`exists (select 1 from ${followRequests} as rq where rq.requester_id = ${viewerId} and rq.target_id = ${profiles.userId})`,
      isPrivate: profiles.isPrivate,
      blockedByMe: sql<number>`exists (select 1 from ${blocks} as b1 where b1.blocker_id = ${viewerId} and b1.blocked_id = ${profiles.userId})`,
      blockedMe: sql<number>`exists (select 1 from ${blocks} as b2 where b2.blocker_id = ${profiles.userId} and b2.blocked_id = ${viewerId})`,
      mutedByMe: sql<number>`exists (select 1 from ${mutes} as m1 where m1.muter_id = ${viewerId} and m1.muted_id = ${profiles.userId})`,
      canSeeContent: sql<number>`${personVisible(viewerId, profiles.userId)}`,
    })
    .from(profiles)
    .where(and(eq(profiles.username, normalizeUsername(username)), eq(profiles.status, "active")))
    .get();
  if (!row) return null;

  const isMe = row.userId === viewerId;
  // The Mates line would name followers of a private account, so it shows only when its posts do.
  const mates = isMe || !row.canSeeContent ? { names: [], total: 0 } : await getMates(db, viewerId, row.userId);

  return {
    userId: row.userId,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    bio: row.bio,
    link: row.link,
    location: row.location,
    avatarKey: row.avatarKey,
    bannerKey: row.bannerKey,
    joinedAt: row.joinedAt.getTime(),
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    postCount: row.canSeeContent ? row.postCount : null,
    iFollow: Boolean(row.iFollow),
    requested: Boolean(row.requested),
    isPrivate: row.isPrivate,
    blockedByMe: Boolean(row.blockedByMe),
    blockedMe: Boolean(row.blockedMe),
    mutedByMe: Boolean(row.mutedByMe),
    canSeeContent: Boolean(row.canSeeContent),
    isMe,
    mates,
  };
}

/** People the viewer follows who also follow `targetId`. */
async function getMates(db: Db, viewerId: string, targetId: string): Promise<{ names: string[]; total: number }> {
  const result = await db.all<{ first_name: string; last_name: string; total: number }>(sql`
    select p.first_name, p.last_name, count(*) over () as total
    from follows mine
    join follows theirs on theirs.follower_id = mine.followee_id
    join profiles p on p.user_id = mine.followee_id
    where mine.follower_id = ${viewerId} and theirs.followee_id = ${targetId} and p.status = 'active'
    order by mine.created_at desc
    limit ${MATE_NAMES}
  `);
  return {
    names: result.map((r) => `${r.first_name} ${r.last_name}`),
    total: result[0]?.total ?? 0,
  };
}

const editSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(50, "Use 50 characters or fewer"),
  lastName: z.string().trim().min(1, "Enter your last name").max(50, "Use 50 characters or fewer"),
  bio: z.string().trim().max(160, "Use 160 characters or fewer"),
  location: z.string().trim().max(60, "Use 60 characters or fewer"),
  link: z.string().trim().max(LINK_MAX, `Use ${LINK_MAX} characters or fewer`),
});

export type EditProfileResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "failed"; fieldErrors: Record<string, string> };

// Control characters other than newline never belong in a bio.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Saves your own first name, last name, bio, city or country, link and pictures. The username
 * never changes. For `avatarKey` and `bannerKey`: leave out to keep the picture, send `null` to
 * remove it, or send the key from an upload. A key is checked again here (yours, still stored,
 * really an image) before it is attached, and a replaced picture is deleted afterwards.
 */
export async function updateProfile(db: Db, userId: string, raw: unknown, media?: R2Bucket): Promise<EditProfileResult> {
  const parsed = editSchema.safeParse(raw);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }
  const data = parsed.success ? parsed.data : null;

  // Checked on their own so one bad field never hides another.
  const fields = (raw ?? {}) as Record<string, unknown>;
  const typedLink = typeof fields.link === "string" ? fields.link.trim() : "";
  let link: string | null = null;
  if (typedLink !== "") {
    const result = normalizeLink(typedLink);
    if (result.ok) link = result.url;
    else errors.link ??= result.reason === "too_long" ? `Use ${LINK_MAX} characters or fewer` : "Enter a web address such as riya.dev";
  }
  for (const key of ["bio", "location"] as const) {
    const value = fields[key];
    if (typeof value === "string" && CONTROL.test(value)) errors[key] ??= "That text has characters we cannot save";
  }

  const pictures: { avatarKey?: string | null; bannerKey?: string | null } = {};
  for (const [field, kind] of [["avatarKey", "avatar"], ["bannerKey", "banner"]] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    if (value === null) pictures[field] = null;
    else if (media && (await isAttachable(media, userId, kind, value))) pictures[field] = value as string;
    else errors[kind] = "That picture is not available. Choose it again.";
  }

  if (!data || Object.keys(errors).length > 0) return { ok: false, code: "invalid", fieldErrors: errors };

  const before = Object.keys(pictures).length > 0
    ? await db.select({ avatarKey: profiles.avatarKey, bannerKey: profiles.bannerKey }).from(profiles).where(eq(profiles.userId, userId)).get()
    : undefined;

  try {
    // The profile and the display name on the account change together.
    await db.batch([
      db
        .update(profiles)
        .set({
          firstName: data.firstName,
          lastName: data.lastName,
          bio: data.bio,
          location: data.location === "" ? null : data.location,
          link,
          ...pictures,
        })
        .where(eq(profiles.userId, userId)),
      db.update(user).set({ name: `${data.firstName} ${data.lastName}` }).where(eq(user.id, userId)),
    ]);
  } catch {
    return { ok: false, code: "failed", fieldErrors: {} };
  }

  // The new pictures are attached; now the replaced ones can go.
  if (media && before) {
    for (const field of ["avatarKey", "bannerKey"] as const) {
      if (field in pictures && before[field] && before[field] !== pictures[field]) await removePicture(media, before[field]);
    }
  }
  return { ok: true };
}
