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
  (t) => [
    check("instance_secrets_name", sql`${t.name} in ('resend_api_key', 'resend_from', 'klipy_api_key', 'polar_access_token', 'polar_webhook_secret')`),
  ],
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
    /**
     * A member the admin made a moderator (owner decision, session 46). The role stays "member", so the
     * one-admin rule is untouched. 0 or 1 (a CHECK added by hand in migration 0016, as drizzle would rebuild the table).
     */
    isModerator: integer("is_moderator", { mode: "boolean" }).notNull().default(false),
    /**
     * What this member charges a month, in US cents, or null when they offer no subscription (owner decision, session
     * 49). $1.00 to $100.00; the database checks it (a CHECK added by hand in migration 0019, as drizzle would rebuild the table).
     */
    subscriptionPriceCents: integer("subscription_price_cents"),
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
    /**
     * Where the post was made, as plain text such as "Berlin, Germany" (never coordinates). 1 to 60
     * characters; the database checks it too (a CHECK added by hand in migration 0011, because
     * drizzle would rebuild the whole table to add one, and a rebuild risks cascade deletes on D1).
     */
    place: text("place"),
    /**
     * The post this one quotes, or null. A post is a reply or a quote, never both (the database checks
     * it, in a CHECK added by hand in migration 0013). If the original row is ever removed the quote stays
     * and its card says the post is not available.
     */
    quotedPostId: text("quoted_post_id").references((): AnySQLiteColumn => posts.id, { onDelete: "set null" }),
    replyCount: integer("reply_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    /** How many people reposted it. Never negative (checked by hand in migration 0013). */
    repostCount: integer("repost_count").notNull().default(0),
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

/**
 * The one GIF a post may carry (docs/PRD.md section 8.2). The picture stays at Klipy: we keep only its
 * address (never a copy, as Klipy's rules require) and its size so the page does not jump. The
 * database accepts only Klipy's own media hosts; the server checks the address again with a real
 * URL parser. A GIF never goes with photos, which the server enforces.
 */
export const postGifs = sqliteTable(
  "post_gifs",
  {
    postId: text("post_id")
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Klipy's title for it, used as the picture's description. */
    title: text("title"),
  },
  (t) => [
    check(
      "post_gifs_url",
      sql`${t.url} like 'https://static.klipy.com/%' or ${t.url} like 'https://static1.klipy.com/%' or ${t.url} like 'https://static2.klipy.com/%'`,
    ),
    check("post_gifs_size", sql`${t.width} between 1 and 4096 and ${t.height} between 1 and 4096`),
    check("post_gifs_title", sql`${t.title} is null or length(${t.title}) <= 140`),
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

/**
 * The hashtags of a post, one row per distinct tag (docs/PRD.md section 8.2): lower-cased, 1 to 50
 * characters, at most 10 a post (the server keeps to that). `created_at` is the post's own time, so a
 * tag's posts can be listed newest first from this index.
 */
export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tag] }),
    check("post_tags_length", sql`length(${t.tag}) between 1 and 50`),
    index("post_tags_tag_idx").on(t.tag, t.createdAt, t.postId),
  ],
);

/**
 * The people a post mentions that exist, are active and have not blocked or been blocked by the
 * author. A mention is drawn as a link only when it is in this table. One row per person per post.
 */
export const postMentions = sqliteTable(
  "post_mentions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index("post_mentions_user_idx").on(t.userId)],
);

/**
 * The link card of a post (docs/PRD.md section 8.2): the title, description, picture address and site
 * name of the first web address in its text, as our server read them from that page. The text is plain
 * text; the picture is an https address that the reader's phone loads from its own site (never copied
 * to our storage). At most one a post; the database checks every length and the address shapes.
 */
export const postLinks = sqliteTable(
  "post_links",
  {
    postId: text("post_id")
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    image: text("image"),
    site: text("site").notNull(),
  },
  (t) => [
    check("post_links_url", sql`(${t.url} like 'http://%' or ${t.url} like 'https://%') and length(${t.url}) <= 500`),
    check("post_links_title", sql`length(${t.title}) between 1 and 150`),
    check("post_links_description", sql`length(${t.description}) <= 300`),
    check("post_links_image", sql`${t.image} is null or (${t.image} like 'https://%' and length(${t.image}) <= 500)`),
    check("post_links_site", sql`length(${t.site}) between 1 and 60`),
  ],
);

/** One row per person per post. Reposting twice leaves one row. The counter on the post changes in the same batch. */
export const reposts = sqliteTable(
  "reposts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index("reposts_post_idx").on(t.postId),
    // A person's reposts, newest first (their profile and the feeds that include them).
    index("reposts_user_idx").on(t.userId, t.createdAt),
  ],
);

/** Private saves. Nobody sees another person's list or a count on a post (docs/PRD.md section 8.9). */
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] }), index("bookmarks_user_idx").on(t.userId, t.createdAt)],
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
  "subscribe",
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
      sql`${t.type} in ('like', 'repost', 'follow', 'follow_request', 'reply', 'quote', 'mention', 'invite_used', 'pending_approval', 'subscribe')`,
    ),
    check("notifications_no_self", sql`${t.recipientId} <> ${t.actorId}`),
    // Alerts about people have no post; alerts about posts always have one.
    check(
      "notifications_post_matches_type",
      sql`(${t.type} in ('follow', 'follow_request', 'invite_used', 'pending_approval', 'subscribe')) = (${t.postId} is null)`,
    ),
    // The same person doing the same thing alerts once, however often it is sent. Two indexes, because
    // an empty post never counts as equal to another empty post in a unique index.
    uniqueIndex("notifications_once_per_post").on(t.recipientId, t.actorId, t.type, t.postId).where(sql`${t.postId} is not null`),
    uniqueIndex("notifications_once_per_person").on(t.recipientId, t.actorId, t.type).where(sql`${t.postId} is null`),
    index("notifications_recipient_idx").on(t.recipientId, t.createdAt, t.id),
    index("notifications_unread_idx").on(t.recipientId).where(sql`${t.readAt} is null`),
  ],
);

/** The steps a report case moves through. */
export const REPORT_STATUSES = ["open", "reviewing", "closed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * One case per report (docs/PRD.md, "Reporting a post"). `caseNo` is the number people read out (shown as
 * CASE-000123); `id` is the row's own id. The case keeps its own copy of the post as it was reported, so it
 * still makes sense if the post is later edited out or deleted, and so staff read what the reporter read.
 * Nothing here is ever shown to the person who wrote the post.
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    caseNo: integer("case_no").notNull(),
    /** The post. Kept as null if its row is ever removed for good; the copy below stays. */
    postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
    postAuthorId: text("post_author_id").references(() => user.id, { onDelete: "set null" }),
    /** The copy of the post taken when it was reported. */
    postAuthorUsername: text("post_author_username").notNull(),
    postBody: text("post_body").notNull(),
    postPhotos: integer("post_photos").notNull().default(0),
    postHasGif: integer("post_has_gif", { mode: "boolean" }).notNull().default(false),
    postHasLink: integer("post_has_link", { mode: "boolean" }).notNull().default(false),
    postIsReply: integer("post_is_reply", { mode: "boolean" }).notNull().default(false),
    postCreatedAt: integer("post_created_at", { mode: "timestamp_ms" }).notNull(),
    /** Who reported. Kept as null if that person is ever removed. */
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    /** What the reporter added, 0 to 500 characters. */
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("open"),
    /** Set when the case is closed. */
    outcome: text("outcome"),
    /** Staff's own note on how it ended, 0 to 500 characters. Never shown to the reporter. */
    resolutionNote: text("resolution_note").notNull().default(""),
    /** Who took it, or closed it. */
    handledBy: text("handled_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("reports_case_no_idx").on(t.caseNo),
    check("reports_case_no", sql`${t.caseNo} >= 1`),
    check(
      "reports_category",
      sql`${t.category} in ('spam', 'harassment', 'hate', 'threat', 'sexual', 'self_harm', 'misinformation', 'impersonation', 'private_info', 'illegal', 'other')`,
    ),
    check("reports_note_length", sql`length(${t.note}) <= 500 and length(${t.resolutionNote}) <= 500`),
    check("reports_status", sql`${t.status} in ('open', 'reviewing', 'closed')`),
    check("reports_outcome", sql`${t.outcome} is null or ${t.outcome} in ('no_action', 'handled', 'removed', 'duplicate')`),
    // A closed case has an outcome and a closing time; an unclosed one has neither.
    check("reports_closed_fields", sql`(${t.status} = 'closed') = (${t.outcome} is not null and ${t.closedAt} is not null)`),
    // A person has one live case per post. Reporting it again gives them the same case back.
    uniqueIndex("reports_one_live_per_reporter")
      .on(t.reporterId, t.postId)
      .where(sql`${t.status} <> 'closed'`),
    index("reports_status_idx").on(t.status, t.caseNo),
    index("reports_post_idx").on(t.postId),
    index("reports_reporter_idx").on(t.reporterId, t.caseNo),
  ],
);

/** What happened to a case, oldest first. Written in the same batch as the change it records. */
export const reportEvents = sqliteTable(
  "report_events",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    /** Who did it. Kept as null if that person is ever removed. */
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    /** For "closed": the outcome. Otherwise empty. */
    detail: text("detail").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("report_events_type", sql`${t.type} in ('filed', 'review_started', 'closed', 'reopened')`),
    index("report_events_report_idx").on(t.reportId, t.createdAt, t.id),
  ],
);

/**
 * How paid subscriptions are set up (docs/PRD.md, "Paid subscriptions"). One row, present once the owner has saved
 * the payment page; no row means nothing is set up. The Polar token and webhook secret are not here: they are
 * encrypted in `instance_secrets`. `creator_percent` is the share of each payment (before tax) that goes to the member
 * being paid for; the owner keeps the rest and pays Polar's fee out of it.
 */
export const paymentSettings = sqliteTable(
  "payment_settings",
  {
    id: text("id").primaryKey().default("singleton"),
    /** The owner's switch for the whole feature. Off until the keys are saved and the owner turns it on. */
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    mode: text("mode").notNull().default("sandbox"),
    creatorPercent: integer("creator_percent").notNull().default(50),
    /**
     * Polar's own fee on a payment, used to estimate what the owner keeps: a percent in hundredths (450 is 4.50%) of the
     * payment before tax, plus a fixed amount in US cents. Polar does not report its fee on each payment in a form we can
     * rely on, so this is the owner's own entry from their Polar plan. Checked in migration 0022.
     */
    feeBp: integer("fee_bp").notNull().default(450),
    feeFixedCents: integer("fee_fixed_cents").notNull().default(40),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("payment_settings_singleton", sql`${t.id} = 'singleton'`),
    check("payment_settings_enabled", sql`${t.enabled} in (0, 1)`),
    check("payment_settings_mode", sql`${t.mode} in ('sandbox', 'production')`),
    check("payment_settings_creator_percent", sql`${t.creatorPercent} between 0 and 100`),
  ],
);

/** The states Polar gives a subscription. Only "active" and "trialing" give a subscriber access. */
export const SUBSCRIPTION_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The states in which a subscriber has paid up. A subscription they stopped keeps one of these until the period ends. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const satisfies readonly SubscriptionStatus[];

/**
 * The product Polar sells for one member at one price (docs/PRD.md, "Paid subscriptions"). Made when a member first
 * has that price and a subscriber taps Subscribe; reused after that. `mode` keeps test (sandbox) products apart from
 * live ones, because their ids mean nothing to the other.
 */
export const polarProducts = sqliteTable(
  "polar_products",
  {
    mode: text("mode").notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    /** Polar's id for the product (a UUID). */
    productId: text("product_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.mode, t.creatorId, t.priceCents] }),
    check("polar_products_mode", sql`${t.mode} in ('sandbox', 'production')`),
    check("polar_products_price", sql`${t.priceCents} between 100 and 10000`),
  ],
);

/**
 * One member's subscription to another, kept in step with Polar by its webhooks. Written only from a message whose
 * signature checked out. `mode` is the Polar mode it was made in: a test (sandbox) subscription never gives access
 * on a live site. `polarModifiedAt` is Polar's own "last changed" time, so a late older message cannot undo a newer one.
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    polarId: text("polar_id").notNull().unique(),
    mode: text("mode").notNull(),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    /** True once the subscriber has chosen to stop: access lasts until the period they paid for ends. */
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
    /** The price in US cents at which this subscription renews. */
    priceCents: integer("price_cents").notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    /** When the creator was told about this subscription. Set once, the first time it is paid up, so repeats never alert twice. */
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }),
    polarModifiedAt: integer("polar_modified_at").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("subscriptions_mode", sql`${t.mode} in ('sandbox', 'production')`),
    check("subscriptions_status", sql`${t.status} in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')`),
    check("subscriptions_not_self", sql`${t.subscriberId} <> ${t.creatorId}`),
    check("subscriptions_price", sql`${t.priceCents} >= 0`),
    // "Is this person subscribed to that one" is asked for every locked post, and "who has subscribed to me" for the counts.
    index("subscriptions_pair_idx").on(t.subscriberId, t.creatorId, t.status),
    index("subscriptions_creator_idx").on(t.creatorId, t.status),
  ],
);

/**
 * What one Polar payment earned the member it was for: one row per Polar order, worked out again from the order each
 * time Polar sends it, so a repeated or late message changes nothing it should not. `splitPercent` is the percent in
 * force when the first message arrived and never changes after, so changing the split affects only later payments.
 * Amounts are US cents; `netCents` is the payment before tax.
 */
export const subscriptionPayments = sqliteTable(
  "subscription_payments",
  {
    id: text("id").primaryKey(),
    polarOrderId: text("polar_order_id").notNull().unique(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** What the subscriber paid, tax included (the price plus any tax Polar added). */
    totalCents: integer("total_cents").notNull().default(0),
    /** The tax in it, which Polar collects and pays on. */
    taxCents: integer("tax_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** The tax that went back with a refund. */
    refundedTaxCents: integer("refunded_tax_cents").notNull().default(0),
    /** Our estimate of Polar's fee on this payment, worked out once when it was first seen at the rate set then. */
    feeCents: integer("fee_cents").notNull().default(0),
    splitPercent: integer("split_percent").notNull(),
    creatorCents: integer("creator_cents").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
    polarModifiedAt: integer("polar_modified_at").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [
    check("subscription_payments_mode", sql`${t.mode} in ('sandbox', 'production')`),
    check("subscription_payments_amounts", sql`${t.netCents} >= 0 and ${t.refundedCents} >= 0`),
    check("subscription_payments_split", sql`${t.splitPercent} between 0 and 100`),
    // The member never earns more than was paid, or less than nothing.
    check("subscription_payments_share", sql`${t.creatorCents} >= 0 and ${t.creatorCents} <= ${t.netCents}`),
    index("subscription_payments_creator_idx").on(t.creatorId, t.mode, t.paidAt),
    index("subscription_payments_subscription_idx").on(t.subscriptionId),
  ],
);

/**
 * What the owner has paid out to a member, by hand for now (docs/PRD.md, "Paid subscriptions"). A mistake is voided, not
 * deleted, so the record stays whole. `mode` keeps test (sandbox) payouts apart from live ones. A payout can never be
 * recorded for more than the member is owed at that moment (the insert itself checks).
 */
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note").notNull().default(""),
    /** The admin who recorded it. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("payouts_mode", sql`${t.mode} in ('sandbox', 'production')`),
    check("payouts_amount", sql`${t.amountCents} between 1 and 100000000`),
    check("payouts_note", sql`length(${t.note}) <= 200`),
    index("payouts_creator_idx").on(t.creatorId, t.mode, t.createdAt),
  ],
);
