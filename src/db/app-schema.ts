// App tables for the instance and access slice (docs/PRD.md section 10).
// Better Auth owns its own tables in auth-schema.ts. Ids are Stripe-style (src/lib/ids.ts),
// times are integer milliseconds UTC, booleans are 0/1, enums are text with a CHECK.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * One row, present only once /setup has finished. No row means the instance is not
 * configured yet. The fixed primary key is what makes setup one-time: a second insert fails.
 */
export const instance = sqliteTable(
  "instance",
  {
    id: text("id").primaryKey().default("singleton"),
    name: text("name").notNull(),
    logoKey: text("logo_key"),
    faviconKey: text("favicon_key"),
    primaryColor: text("primary_color").notNull(),
    radius: text("radius").notNull(),
    fontFamily: text("font_family").notNull(),
    avatarStyle: text("avatar_style").notNull(),
    themeDefault: text("theme_default").notNull().default("system"),
    inviteQuota: integer("invite_quota").notNull().default(5),
    signupPolicy: text("signup_policy").notNull().default("invite_only"),
    gifsEnabled: integer("gifs_enabled", { mode: "boolean" }).notNull().default(false),
    placesEnabled: integer("places_enabled", { mode: "boolean" }).notNull().default(false),
    linkPreviewsEnabled: integer("link_previews_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("instance_singleton", sql`${t.id} = 'singleton'`),
    check("instance_name_length", sql`length(${t.name}) between 1 and 30`),
    check(
      "instance_primary_color_hex",
      // D1 rejects long GLOB patterns ("too complex"), so test for any character that is not hex.
      sql`length(${t.primaryColor}) in (4, 7) and substr(${t.primaryColor}, 1, 1) = '#' and substr(${t.primaryColor}, 2) not glob '*[^0-9A-Fa-f]*'`,
    ),
    check("instance_radius", sql`${t.radius} in ('zero', 'sm', 'md', 'lg')`),
    check("instance_theme_default", sql`${t.themeDefault} in ('dark', 'light', 'system')`),
    check("instance_invite_quota", sql`${t.inviteQuota} >= 0`),
    check("instance_signup_policy", sql`${t.signupPolicy} in ('invite_only')`),
  ],
);

/** Encrypted third-party keys (Resend, Klipy). Kept apart from `instance` so theme code never reads them. */
export const instanceSecrets = sqliteTable(
  "instance_secrets",
  {
    name: text("name").primaryKey(),
    /** `v1:<base64 iv>:<base64 ciphertext>`, see src/lib/secrets.ts. */
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [check("instance_secrets_name", sql`${t.name} in ('resend_api_key', 'resend_from', 'klipy_api_key')`)],
);

/** One profile per user. The primary key is the Better Auth user id. */
export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    username: text("username").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    bio: text("bio").notNull().default(""),
    link: text("link"),
    location: text("location"),
    isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
    avatarKey: text("avatar_key"),
    bannerKey: text("banner_key"),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    /** Who invited this person. Kept as null if that person is deleted. */
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("profiles_username_rules", sql`length(${t.username}) between 3 and 15 and ${t.username} not glob '*[^a-z0-9_]*'`),
    check("profiles_name_length", sql`length(${t.firstName}) between 1 and 50 and length(${t.lastName}) between 1 and 50`),
    check("profiles_bio_length", sql`length(${t.bio}) <= 160`),
    check("profiles_role", sql`${t.role} in ('admin', 'member')`),
    check("profiles_status", sql`${t.status} in ('active', 'pending')`),
    // Exactly one admin, enforced by the database (docs/PRD.md section 3).
    uniqueIndex("profiles_one_admin").on(t.role).where(sql`${t.role} = 'admin'`),
    index("profiles_invited_by_idx").on(t.invitedBy),
    index("profiles_status_idx").on(t.status),
  ],
);

/** A member's personal, reusable invite link. At most one active link per member. */
export const inviteLinks = sqliteTable(
  "invite_links",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Long random value used in /sign-up?invite=<code>. Not an id. */
    code: text("code").notNull().unique(),
    usesCount: integer("uses_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("invite_links_uses_count", sql`${t.usesCount} >= 0`),
    uniqueIndex("invite_links_one_active_per_owner").on(t.ownerUserId).where(sql`${t.revokedAt} is null`),
  ],
);

/** Which link brought a person in, and whether that sign-up was auto-approved or is waiting. */
export const inviteUses = sqliteTable(
  "invite_uses",
  {
    id: text("id").primaryKey(),
    inviteLinkId: text("invite_link_id")
      .notNull()
      .references(() => inviteLinks.id, { onDelete: "cascade" }),
    /** A person signs up once, so one use per user. */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("invite_uses_outcome", sql`${t.outcome} in ('approved', 'pending')`),
    index("invite_uses_link_idx").on(t.inviteLinkId),
  ],
);

/**
 * One row per allowed attempt at something limited (docs/PRD.md section 8.11). The key is a
 * label plus a salted hash, never a raw IP address or email. Rows are short-lived and pruned.
 * A plain row number is enough here: nothing refers to these rows.
 */
export const rateHits = sqliteTable(
  "rate_hits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("rate_hits_key_at_idx").on(t.key, t.at)],
);

/** A post, or a reply when `parentId` is set. Text only for now (docs/PRD.md section 8.2). */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The post this one replies to. Null for a top-level post. */
    parentId: text("parent_id").references((): AnySQLiteColumn => posts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyCount: integer("reply_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    /** Deleting hides the post everywhere but keeps the row. */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("posts_body_length", sql`length(${t.body}) between 1 and 280`),
    check("posts_counts", sql`${t.replyCount} >= 0 and ${t.likeCount} >= 0`),
    // The home feed: top-level posts, newest first.
    index("posts_feed_idx").on(t.createdAt, t.id).where(sql`${t.parentId} is null and ${t.deletedAt} is null`),
    index("posts_replies_idx").on(t.parentId, t.createdAt).where(sql`${t.parentId} is not null`),
    index("posts_author_idx").on(t.authorId, t.createdAt),
  ],
);

/** Most photos one post can carry (docs/PRD.md section 8.2). */
export const POST_PHOTO_MAX = 4;

/** The photos on a post, in the order shown. The key points at a file in R2 under `posts/`. */
export const postMedia = sqliteTable(
  "post_media",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    key: text("key").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    check("post_media_position", sql`${t.position} between 0 and 3`),
    check("post_media_key", sql`${t.key} like 'posts/%'`),
  ],
);

/** One row per person per post. Idempotent: liking twice leaves one row. */
export const likes = sqliteTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] }), index("likes_post_idx").on(t.postId)],
);

/** Who follows whom. One row per pair; the database refuses following yourself. */
export const follows = sqliteTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followeeId: text("followee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
    // "Who follows X" newest first, and "who does X follow" newest first.
    index("follows_followee_idx").on(t.followeeId, t.createdAt, t.followerId),
    index("follows_follower_idx").on(t.followerId, t.createdAt, t.followeeId),
  ],
);

/**
 * Someone asked to follow a private account and is waiting for an answer (docs/PRD.md section 8.8).
 * One row per pair. Approving turns it into a follow; declining or cancelling deletes it.
 */
export const followRequests = sqliteTable(
  "follow_requests",
  {
    requesterId: text("requester_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.targetId] }),
    check("follow_requests_not_self", sql`${t.requesterId} <> ${t.targetId}`),
    // "Who is waiting on me", oldest first.
    index("follow_requests_target_idx").on(t.targetId, t.createdAt, t.requesterId),
  ],
);

/** Who blocked whom. One row per pair; the database refuses blocking yourself. */
export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
    // "Who blocked me" is asked on every list, so it needs its own index; and "whom did I block", newest first.
    index("blocks_blocked_idx").on(t.blockedId, t.blockerId),
    index("blocks_blocker_idx").on(t.blockerId, t.createdAt, t.blockedId),
  ],
);

/** Who muted whom. One row per pair; the database refuses muting yourself. */
export const mutes = sqliteTable(
  "mutes",
  {
    muterId: text("muter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mutedId: text("muted_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.muterId, t.mutedId] }),
    check("mutes_not_self", sql`${t.muterId} <> ${t.mutedId}`),
    index("mutes_muter_idx").on(t.muterId, t.createdAt, t.mutedId),
  ],
);

/**
 * Hosted font files for the chosen family (docs/PRD.md section 5). One row per weight, style and
 * script subset; two rows may share a file when the font is a variable font. The file lives in R2.
 */
export const fonts = sqliteTable(
  "fonts",
  {
    family: text("family").notNull(),
    weight: integer("weight").notNull(),
    style: text("style").notNull(),
    subset: text("subset").notNull(),
    /** The CSS unicode-range for this subset, so a browser downloads only the files it needs. */
    unicodeRange: text("unicode_range").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.family, t.weight, t.style, t.subset] }),
    check("fonts_weight", sql`${t.weight} between 100 and 900`),
    check("fonts_style", sql`${t.style} in ('normal', 'italic')`),
    check("fonts_subset", sql`${t.subset} in ('latin', 'latin-ext')`),
  ],
);

/**
 * What /hq/email shows about sending: when the last email went out and the last error Resend gave.
 * One row. Holds no address and no key; the error text has both scrubbed before it is stored.
 */
export const emailState = sqliteTable(
  "email_state",
  {
    id: text("id").primaryKey().default("singleton"),
    lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("email_state_singleton", sql`${t.id} = 'singleton'`),
    check("email_state_error_length", sql`${t.lastError} is null or length(${t.lastError}) <= 300`),
  ],
);

/** The kinds of alert the app can show (docs/PRD.md section 8.7). Only some exist in the app so far. */
export const NOTIFICATION_TYPES = [
  "like",
  "repost",
  "follow",
  "follow_request",
  "reply",
  "quote",
  "mention",
  "invite_used",
  "pending_approval",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * One alert for one person about one thing another person did. The row is written in the same
 * batch as the like, follow, reply or sign-up that causes it, and removed in the batch that undoes
 * it. The database refuses an alert about your own action.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** The post this is about (the liked post, or the reply). Empty for follows and sign-up alerts. */
    postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    /** Empty while unread. */
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check(
      "notifications_type",
      sql`${t.type} in ('like', 'repost', 'follow', 'follow_request', 'reply', 'quote', 'mention', 'invite_used', 'pending_approval')`,
    ),
    check("notifications_no_self", sql`${t.recipientId} <> ${t.actorId}`),
    // Alerts about people have no post; alerts about posts always have one.
    check(
      "notifications_post_matches_type",
      sql`(${t.type} in ('follow', 'follow_request', 'invite_used', 'pending_approval')) = (${t.postId} is null)`,
    ),
    // The same person doing the same thing alerts once, however often it is sent. Two indexes, because
    // an empty post never counts as equal to another empty post in a unique index.
    uniqueIndex("notifications_once_per_post").on(t.recipientId, t.actorId, t.type, t.postId).where(sql`${t.postId} is not null`),
    uniqueIndex("notifications_once_per_person").on(t.recipientId, t.actorId, t.type).where(sql`${t.postId} is null`),
    index("notifications_recipient_idx").on(t.recipientId, t.createdAt, t.id),
    index("notifications_unread_idx").on(t.recipientId).where(sql`${t.readAt} is null`),
  ],
);
