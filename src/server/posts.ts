// Posts, replies, quotes, reposts and likes (docs/PRD.md sections 8.2 and 8.3). Pages and actions call these;
// they never write SQL. Who may see what is always `visiblePosts`. A counter on a post changes
// in the same db.batch() as the row that causes it.

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { alias } from "drizzle-orm/sqlite-core";
import { bookmarks, follows, likes, POST_PHOTO_MAX, postGifs, postMedia, postMentions, posts, postTags, profiles, reposts } from "@/db/schema";
import { checkGif, type PostGif } from "@/lib/gif";
import { isId, newId } from "@/lib/ids";
import { checkPlace } from "@/lib/place";
import { extractEntities } from "@/lib/post-entities";
import { checkPostText } from "@/lib/post-text";
import { alertOnLike, alertOnMention, alertOnQuote, alertOnReply, alertOnRepost, removeLikeAlert, removeRepostAlert } from "@/server/notifications";
import { notBlockedWith, notMutedBy, personVisible, visiblePosts } from "@/server/visibility";

export const PAGE_SIZE = 20;

/** The card under a quote post: the original, or a note that it cannot be shown to this reader. */
export type QuotedView =
  | {
      available: true;
      id: string;
      body: string;
      createdAt: number;
      /** How many pictures it has, so the card can say so without loading them. */
      photoCount: number;
      hasGif: boolean;
      author: { userId: string; username: string; firstName: string; lastName: string; avatarKey: string | null };
    }
  | { available: false };

/** Who reposted it, for a post shown because someone reposted it. */
export type RepostedBy = { userId: string; username: string; firstName: string; lastName: string };

export type PostView = {
  id: string;
  body: string;
  createdAt: number;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  parentId: string | null;
  /** Storage keys of the photos, in the order shown. Empty for a text-only post. */
  photos: string[];
  /** The one GIF it carries (kept at Klipy, never copied), or null. Never together with photos. */
  gif: PostGif | null;
  /** Where it was posted from, as plain text such as "Berlin, Germany", or null. */
  place: string | null;
  /** The post's hashtags, lower-cased. Only these are drawn as links; a `#word` not in the list is plain text. */
  tags: string[];
  /** Usernames (lower-cased) of the people it mentions who exist. Only these are drawn as links. */
  mentions: string[];
  repostCount: number;
  repostedByMe: boolean;
  /** Private: only ever the reader's own saved state, never a count. */
  bookmarkedByMe: boolean;
  /**
   * What the reader may do to share it: a private account's posts can be neither reposted nor quoted,
   * and a reply can be quoted but not reposted. The server checks again when the button is pressed.
   */
  share: "repost_or_quote" | "quote" | "none";
  /** The post this one quotes, or null for an ordinary post. */
  quote: QuotedView | null;
  /** Set only on an item that is in a list because this person reposted it. */
  repostedBy: RepostedBy | null;
  author: { userId: string; username: string; firstName: string; lastName: string; avatarKey: string | null };
};

export type Page = { items: PostView[]; nextCursor: string | null };

// ---- cursors: (milliseconds, id), newest first ----

export function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}_${id}`;
}

export function decodeCursor(raw: unknown): { createdAt: number; id: string } | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,15})_(post_[0-9A-Za-z]{24})$/.exec(raw);
  if (!match || !isId("post", match[2])) return null;
  return { createdAt: Number(match[1]), id: match[2] as string };
}

export function olderThan(cursor: { createdAt: number; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  const at = new Date(cursor.createdAt);
  return or(lt(posts.createdAt, at), and(eq(posts.createdAt, at), lt(posts.id, cursor.id)));
}

// ---- reading ----

export const postColumns = (viewerId: string) => ({
  id: posts.id,
  body: posts.body,
  place: posts.place,
  createdAt: posts.createdAt,
  replyCount: posts.replyCount,
  likeCount: posts.likeCount,
  repostCount: posts.repostCount,
  parentId: posts.parentId,
  quotedPostId: posts.quotedPostId,
  liked: sql<number>`exists (select 1 from ${likes} where ${likes.postId} = ${posts.id} and ${likes.userId} = ${viewerId})`,
  reposted: sql<number>`exists (select 1 from ${reposts} where ${reposts.postId} = ${posts.id} and ${reposts.userId} = ${viewerId})`,
  bookmarked: sql<number>`exists (select 1 from ${bookmarks} where ${bookmarks.postId} = ${posts.id} and ${bookmarks.userId} = ${viewerId})`,
  userId: profiles.userId,
  username: profiles.username,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  avatarKey: profiles.avatarKey,
  authorPrivate: profiles.isPrivate,
});

type Row = {
  id: string;
  body: string;
  place: string | null;
  createdAt: Date;
  replyCount: number;
  likeCount: number;
  repostCount: number;
  parentId: string | null;
  quotedPostId: string | null;
  liked: number;
  reposted: number;
  bookmarked: number;
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarKey: string | null;
  authorPrivate: boolean;
};

// A post with photos or a GIF and no words keeps one space as its text (the database wants 1 to 280
// characters); it is never shown.
const toView = (r: Row): PostView => ({
  id: r.id,
  body: r.body.trim(),
  createdAt: r.createdAt.getTime(),
  replyCount: r.replyCount,
  likeCount: r.likeCount,
  likedByMe: Boolean(r.liked),
  tags: [],
  mentions: [],
  repostCount: r.repostCount,
  repostedByMe: Boolean(r.reposted),
  bookmarkedByMe: Boolean(r.bookmarked),
  parentId: r.parentId,
  photos: [],
  gif: null,
  place: r.place,
  share: r.authorPrivate ? "none" : r.parentId ? "quote" : "repost_or_quote",
  // Filled in by `hydrate` (the card needs the original, which may not be visible to this reader).
  quote: r.quotedPostId ? { available: false } : null,
  repostedBy: null,
  author: { userId: r.userId, username: r.username, firstName: r.firstName, lastName: r.lastName, avatarKey: r.avatarKey },
});

/**
 * Turns query rows into posts ready to show: fills in the photos and the GIF (one query each) and the
 * card of every quoted post, which is the original only if this reader may see it. `by` says, for an
 * item that is in the list because someone reposted it, who did.
 */
async function hydrate(db: Db, viewerId: string, rows: Row[], by: (RepostedBy | null)[] = []): Promise<PostView[]> {
  const items = rows.map((r, i) => ({ ...toView(r), repostedBy: by[i] ?? null }));
  if (items.length === 0) return items;
  const ids = [...new Set(items.map((p) => p.id))];
  const quotedIds = [...new Set(rows.flatMap((r) => (r.quotedPostId ? [r.quotedPostId] : [])))];
  // Tags and mentions can only be in text that has a # or an @, so other posts need no query.
  const withHash = [...new Set(items.filter((p) => p.body.includes("#")).map((p) => p.id))];
  const withAt = [...new Set(items.filter((p) => p.body.includes("@")).map((p) => p.id))];
  const [media, gifs, quoted, tagRows, mentionRows] = await Promise.all([
    db
      .select({ postId: postMedia.postId, key: postMedia.key })
      .from(postMedia)
      .where(inArray(postMedia.postId, ids))
      .orderBy(asc(postMedia.postId), asc(postMedia.position)),
    db
      .select({ postId: postGifs.postId, url: postGifs.url, width: postGifs.width, height: postGifs.height, title: postGifs.title })
      .from(postGifs)
      .where(inArray(postGifs.postId, ids)),
    quotedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: posts.id,
            body: posts.body,
            createdAt: posts.createdAt,
            photoCount: sql<number>`(select count(*) from ${postMedia} where ${postMedia.postId} = ${posts.id})`,
            hasGif: sql<number>`exists (select 1 from ${postGifs} where ${postGifs.postId} = ${posts.id})`,
            userId: profiles.userId,
            username: profiles.username,
            firstName: profiles.firstName,
            lastName: profiles.lastName,
            avatarKey: profiles.avatarKey,
          })
          .from(posts)
          .innerJoin(profiles, eq(profiles.userId, posts.authorId))
          .where(and(visiblePosts(viewerId), inArray(posts.id, quotedIds))),
    withHash.length === 0
      ? Promise.resolve([])
      : db.select({ postId: postTags.postId, tag: postTags.tag }).from(postTags).where(inArray(postTags.postId, withHash)),
    withAt.length === 0
      ? Promise.resolve([])
      : db
          .select({ postId: postMentions.postId, username: profiles.username })
          .from(postMentions)
          .innerJoin(profiles, eq(profiles.userId, postMentions.userId))
          .where(inArray(postMentions.postId, withAt)),
  ]);
  const tagsOf = new Map<string, string[]>();
  for (const r of tagRows) tagsOf.set(r.postId, [...(tagsOf.get(r.postId) ?? []), r.tag]);
  const mentionsOf = new Map<string, string[]>();
  for (const r of mentionRows) mentionsOf.set(r.postId, [...(mentionsOf.get(r.postId) ?? []), r.username]);
  const byPost = new Map<string, string[]>();
  for (const r of media) byPost.set(r.postId, [...(byPost.get(r.postId) ?? []), r.key]);
  const gifOf = new Map<string, PostGif>();
  for (const g of gifs) gifOf.set(g.postId, { url: g.url, width: g.width, height: g.height, title: g.title });
  const cards = new Map<string, QuotedView>();
  for (const q of quoted) {
    cards.set(q.id, {
      available: true,
      id: q.id,
      body: q.body.trim(),
      createdAt: q.createdAt.getTime(),
      photoCount: q.photoCount,
      hasGif: Boolean(q.hasGif),
      author: { userId: q.userId, username: q.username, firstName: q.firstName, lastName: q.lastName, avatarKey: q.avatarKey },
    });
  }
  return items.map((p, i) => {
    const quotedId = rows[i]?.quotedPostId;
    return {
      ...p,
      photos: byPost.get(p.id) ?? [],
      gif: gifOf.get(p.id) ?? null,
      tags: tagsOf.get(p.id) ?? [],
      mentions: mentionsOf.get(p.id) ?? [],
      quote: quotedId ? (cards.get(quotedId) ?? { available: false }) : null,
    };
  });
}

/** One entry of a list: a row, the time it is placed at (for a repost, when it was reposted), and who reposted it. */
export type Entry = { row: Row; at: number; by: RepostedBy | null };

/** Builds a page from entries already in order. `more` says whether older ones exist; the cursor is the last entry's time and post. */
export async function pageOf(db: Db, viewerId: string, entries: Entry[], more: boolean): Promise<Page> {
  const items = await hydrate(db, viewerId, entries.map((e) => e.row), entries.map((e) => e.by));
  const last = entries[entries.length - 1];
  return { items, nextCursor: more && last ? encodeCursor(last.at, last.row.id) : null };
}

export async function toPage(db: Db, viewerId: string, rows: Row[], limit: number): Promise<Page> {
  const entries = rows.slice(0, limit).map((row) => ({ row, at: row.createdAt.getTime(), by: null }));
  return pageOf(db, viewerId, entries, rows.length > limit);
}

const reposter = alias(profiles, "reposter");

type RepostRow = Row & { repostAt: Date; rUserId: string; rUsername: string; rFirstName: string; rLastName: string };

/** Reposts (newest first) that this reader may see: the original is visible and is not a reply, and so is the person who reposted it. */
async function listRepostRows(
  db: Db,
  viewerId: string,
  opts: { by?: SQL; hideMuted: boolean; cursor: { createdAt: number; id: string } | null; limit: number },
): Promise<RepostRow[]> {
  const at = opts.cursor ? new Date(opts.cursor.createdAt) : null;
  return db
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
        visiblePosts(viewerId),
        isNull(posts.parentId),
        personVisible(viewerId, reposts.userId),
        opts.hideMuted ? notMutedBy(viewerId, reposts.userId) : undefined,
        opts.hideMuted ? notMutedBy(viewerId, posts.authorId) : undefined,
        opts.by,
        opts.cursor && at ? or(lt(reposts.createdAt, at), and(eq(reposts.createdAt, at), lt(posts.id, opts.cursor.id))) : undefined,
      ),
    )
    .orderBy(desc(reposts.createdAt), desc(posts.id))
    .limit(opts.limit + 1);
}

/**
 * Merges a list of original posts with a list of reposts, both newest first, into one page. A post
 * can appear twice: once as itself and once as someone's repost. Several reposts of one post on a
 * page show once (the newest). The cursor is (time, post id), and both lists use it, so the next page
 * starts exactly where this one stopped.
 */
async function mergedPage(db: Db, viewerId: string, originals: Row[], repostRows: RepostRow[], limit: number): Promise<Page> {
  const all: Entry[] = [
    ...originals.map((row) => ({ row, at: row.createdAt.getTime(), by: null })),
    ...repostRows.map((r) => ({
      row: r,
      at: r.repostAt.getTime(),
      by: { userId: r.rUserId, username: r.rUsername, firstName: r.rFirstName, lastName: r.rLastName },
    })),
  ].sort((x, y) => y.at - x.at || (x.row.id < y.row.id ? 1 : x.row.id > y.row.id ? -1 : 0));
  const more = all.length > limit;
  const seen = new Set<string>();
  const kept: Entry[] = [];
  for (const e of all.slice(0, limit)) {
    if (e.by) {
      if (seen.has(e.row.id)) continue;
      seen.add(e.row.id);
    }
    kept.push(e);
  }
  // The cursor is the last entry looked at, even if it was a repeat that was dropped.
  const lastLooked = all.slice(0, limit).at(-1);
  const page = await pageOf(db, viewerId, kept, false);
  return { items: page.items, nextCursor: more && lastLooked ? encodeCursor(lastLooked.at, lastLooked.row.id) : null };
}

/**
 * The home feed: top-level posts, newest first, with the reposts of the people shown. `following`
 * shows your own posts and those of people you follow (and what they reposted); `all` is every
 * visible post (the ranked For you feed replaces it later). People you muted, and what they
 * reposted, are left out of both.
 */
export async function listFeed(
  db: Db,
  viewerId: string,
  opts: { cursor?: unknown; limit?: number; scope?: "all" | "following" } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const fromFollowed =
    opts.scope === "following"
      ? or(
          eq(posts.authorId, viewerId),
          sql`${posts.authorId} in (select ${follows.followeeId} from ${follows} where ${follows.followerId} = ${viewerId})`,
        )
      : undefined;
  const repostedByFollowed =
    opts.scope === "following"
      ? or(
          eq(reposts.userId, viewerId),
          sql`${reposts.userId} in (select ${follows.followeeId} from ${follows} where ${follows.followerId} = ${viewerId})`,
        )
      : undefined;
  const [originals, repostRows] = await Promise.all([
    db
      .select(postColumns(viewerId))
      .from(posts)
      .innerJoin(profiles, eq(profiles.userId, posts.authorId))
      .where(and(visiblePosts(viewerId), notMutedBy(viewerId, posts.authorId), isNull(posts.parentId), fromFollowed, olderThan(cursor)))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1),
    listRepostRows(db, viewerId, { by: repostedByFollowed, hideMuted: true, cursor, limit }),
  ]);
  return mergedPage(db, viewerId, originals, repostRows, limit);
}

/** One person's posts and the posts they reposted (or, with `replies`, their replies), newest first. */
export async function listByAuthor(
  db: Db,
  viewerId: string,
  authorId: string,
  opts: { replies?: boolean; cursor?: unknown; limit?: number } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const originals = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        visiblePosts(viewerId),
        eq(posts.authorId, authorId),
        opts.replies ? isNotNull(posts.parentId) : isNull(posts.parentId),
        olderThan(cursor),
      ),
    )
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  if (opts.replies) return toPage(db, viewerId, originals, limit);
  // On a profile a mute does not hide anything: you opened the page on purpose.
  const repostRows = await listRepostRows(db, viewerId, { by: eq(reposts.userId, authorId), hideMuted: false, cursor, limit });
  return mergedPage(db, viewerId, originals, repostRows, limit);
}

/** One post, or null when it does not exist or this person may not see it. */
export async function getPost(db: Db, viewerId: string, postId: string): Promise<PostView | null> {
  if (!isId("post", postId)) return null;
  const row = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), eq(posts.id, postId)))
    .get();
  if (!row) return null;
  return (await hydrate(db, viewerId, [row]))[0] ?? null;
}

/** Direct replies to a post, newest first. */
export async function listReplies(
  db: Db,
  viewerId: string,
  postId: string,
  opts: { cursor?: unknown; limit?: number } = {},
): Promise<Page> {
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await db
    .select(postColumns(viewerId))
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), eq(posts.parentId, postId), olderThan(decodeCursor(opts.cursor))))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  return toPage(db, viewerId, rows, limit);
}

// ---- writing ----

export type CreatePostResult =
  | { ok: true; id: string }
  | { ok: false; code: "empty" | "too_long" | "bad_characters" | "parent_not_found" | "bad_photos" | "bad_gif" | "gif_with_photos" | "quote_and_reply" | "quote_with_media" | "quote_not_found" | "quote_private" | "place_too_long" | "place_bad_characters" };

const replyCountOf = (parentId: string) =>
  sql`(select count(*) from ${posts} as r where r.parent_id = ${parentId} and r.deleted_at is null)`;

/** True when every key is a distinct post photo this person uploaded, and there are at most four. */
export function photoKeysAreValid(authorId: string, keys: unknown): keys is string[] {
  if (!Array.isArray(keys) || keys.length > POST_PHOTO_MAX || new Set(keys).size !== keys.length) return false;
  const own = new RegExp(`^posts/${authorId}/[0-9A-Za-z]{24}\.(jpg|png|gif|webp)$`);
  return isId("user", authorId) && keys.every((k) => typeof k === "string" && own.test(k));
}

/**
 * Makes a post, or a reply when `parentId` is given. `photoKeys` are keys of pictures already
 * uploaded and checked by the caller (the action); this only checks they are this person's.
 */
export async function createPost(
  db: Db,
  authorId: string,
  rawBody: unknown,
  parentId?: string,
  photoKeys: string[] = [],
  rawPlace?: unknown,
  rawGif?: unknown,
  quotedId?: string,
): Promise<CreatePostResult> {
  if (!photoKeysAreValid(authorId, photoKeys)) return { ok: false, code: "bad_photos" };
  const checkedGif = checkGif(rawGif);
  if (!checkedGif.ok) return { ok: false, code: "bad_gif" };
  const gif = checkedGif.gif;
  if (gif && photoKeys.length > 0) return { ok: false, code: "gif_with_photos" };
  // A post is a reply or a quote, and a quote carries the original instead of pictures or a GIF (PRD 8.2).
  const quoting = quotedId !== undefined;
  if (quoting && parentId !== undefined) return { ok: false, code: "quote_and_reply" };
  if (quoting && (photoKeys.length > 0 || gif)) return { ok: false, code: "quote_with_media" };
  let quotedAuthorId: string | null = null;
  if (quoting) {
    const target = await shareTarget(db, authorId, quotedId);
    if (!target.ok) return { ok: false, code: target.code === "private" ? "quote_private" : "quote_not_found" };
    quotedAuthorId = target.authorId;
  }
  const place = checkPlace(rawPlace);
  if (!place.ok) return { ok: false, code: place.reason === "too_long" ? "place_too_long" : "place_bad_characters" };
  // Photos, a GIF or a quote can stand in for words; the text is then one space (see toView).
  const wordless = (photoKeys.length > 0 || gif !== null || quoting) && typeof rawBody === "string" && rawBody.trim() === "";
  const text = wordless ? ({ ok: true, text: " ", length: 1 } as const) : checkPostText(rawBody);
  if (!text.ok) return { ok: false, code: text.reason };

  let parentAuthorId: string | null = null;
  if (parentId !== undefined) {
    const parent = await getPost(db, authorId, parentId);
    if (!parent) return { ok: false, code: "parent_not_found" };
    parentAuthorId = parent.author.userId;
  }

  // Hashtags and mentions are found in the text. Only people who exist, are active and have no block
  // with the author count as mentioned; the rest stay plain text.
  const { tags, mentions } = wordless ? { tags: [], mentions: [] } : extractEntities(text.text);
  const mentioned =
    mentions.length === 0
      ? []
      : await db
          .select({ userId: profiles.userId })
          .from(profiles)
          .where(and(inArray(profiles.username, mentions), eq(profiles.status, "active"), notBlockedWith(authorId, profiles.userId)));
  // Nobody is alerted twice for one post: the author of a reply's parent already has the reply alert,
  // and the author of a quoted post has the quote alert (docs/PRD.md section 8.7). Nor are you alerted about yourself.
  const alertMentioned = mentioned.map((m) => m.userId).filter((u) => u !== authorId && u !== parentAuthorId && u !== quotedAuthorId);

  const id = newId("post");
  const createdAt = new Date();
  const insert = db
    .insert(posts)
    .values({ id, authorId, parentId: parentId ?? null, quotedPostId: quotedId ?? null, body: text.text, place: place.place, createdAt });
  const photos = photoKeys.map((key, position) => ({ postId: id, position, key }));
  if (parentId === undefined && photos.length === 0 && !gif && !quoting && tags.length === 0 && mentioned.length === 0) {
    await insert;
  } else {
    // The post, its photos or GIF, its tags and mentions with their alerts, for a quote the author's alert, and for a reply the parent's count and the parent's author's alert change together.
    await db.batch([
      insert,
      ...(photos.length > 0 ? [db.insert(postMedia).values(photos)] : []),
      ...(tags.length > 0 ? [db.insert(postTags).values(tags.map((tag) => ({ postId: id, tag, createdAt })))] : []),
      ...(mentioned.length > 0 ? [db.insert(postMentions).values(mentioned.map((m) => ({ postId: id, userId: m.userId })))] : []),
      ...alertMentioned.map((userId) => alertOnMention(db, authorId, userId, id)),
      ...(gif ? [db.insert(postGifs).values({ postId: id, url: gif.url, width: gif.width, height: gif.height, title: gif.title })] : []),
      ...(parentId === undefined
        ? []
        : [db.update(posts).set({ replyCount: replyCountOf(parentId) }).where(eq(posts.id, parentId)), alertOnReply(db, authorId, parentId, id)]),
      // The author of a quoted post hears about it, unless it is the quoter.
      ...(quotedId === undefined ? [] : [alertOnQuote(db, authorId, quotedId, id)]),
    ] as unknown as Parameters<Db["batch"]>[0]);
  }
  return { ok: true, id };
}

/**
 * Whether `viewerId` may repost or quote a post: it must be visible to them, and a private account's
 * posts can be neither reposted nor quoted (docs/PRD.md section 8.8), not even by their owner.
 * `reply` is set when the post is a reply, which cannot be reposted (replies never appear in feeds).
 */
async function shareTarget(
  db: Db,
  viewerId: string,
  postId: string,
): Promise<{ ok: true; authorId: string; isReply: boolean } | { ok: false; code: "not_found" | "private" }> {
  if (!isId("post", postId)) return { ok: false, code: "not_found" };
  const row = await db
    .select({ authorId: posts.authorId, parentId: posts.parentId, isPrivate: profiles.isPrivate })
    .from(posts)
    .innerJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(and(visiblePosts(viewerId), eq(posts.id, postId)))
    .get();
  if (!row) return { ok: false, code: "not_found" };
  if (row.isPrivate) return { ok: false, code: "private" };
  return { ok: true, authorId: row.authorId, isReply: row.parentId !== null };
}

export type RepostResult =
  | { ok: true; reposted: boolean; repostCount: number }
  | { ok: false; code: "not_found" | "private" | "reply" };

/**
 * Sets whether you repost a post (the wanted state, not a flip). The row, the counter on the post and
 * the author's alert change in one batch. Taking a repost back always works, even if the post has since
 * become hidden from you.
 */
export async function setRepost(db: Db, viewerId: string, postId: string, reposted: boolean): Promise<RepostResult> {
  if (!isId("post", postId)) return { ok: false, code: "not_found" };
  if (reposted) {
    const target = await shareTarget(db, viewerId, postId);
    if (!target.ok) return target;
    if (target.isReply) return { ok: false, code: "reply" };
  } else if (!(await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).get())) {
    return { ok: false, code: "not_found" };
  }

  await db.batch([
    reposted
      ? db.insert(reposts).values({ userId: viewerId, postId }).onConflictDoNothing()
      : db.delete(reposts).where(and(eq(reposts.userId, viewerId), eq(reposts.postId, postId))),
    db.update(posts).set({ repostCount: sql`(select count(*) from ${reposts} where ${reposts.postId} = ${postId})` }).where(eq(posts.id, postId)),
    reposted ? alertOnRepost(db, viewerId, postId) : removeRepostAlert(db, viewerId, postId),
  ]);
  const after = await db.select({ repostCount: posts.repostCount }).from(posts).where(eq(posts.id, postId)).get();
  return { ok: true, reposted, repostCount: after?.repostCount ?? 0 };
}

/** Deletes your own post. Anyone else's, or one that is already gone, is "not found". */
export async function deletePost(db: Db, userId: string, postId: string): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  if (!isId("post", postId)) return { ok: false, code: "not_found" };
  const post = await db
    .select({ parentId: posts.parentId })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, userId), isNull(posts.deletedAt)))
    .get();
  if (!post) return { ok: false, code: "not_found" };

  const hide = db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.authorId, userId), isNull(posts.deletedAt)));
  if (post.parentId) {
    const parentId = post.parentId;
    await db.batch([hide, db.update(posts).set({ replyCount: replyCountOf(parentId) }).where(eq(posts.id, parentId))]);
  } else {
    await hide;
  }
  return { ok: true };
}

/** Sets whether you like a post. Sending the wanted state twice changes nothing the second time. */
export async function setLike(
  db: Db,
  viewerId: string,
  postId: string,
  liked: boolean,
): Promise<{ ok: true; liked: boolean; likeCount: number } | { ok: false; code: "not_found" }> {
  const post = await getPost(db, viewerId, postId);
  if (!post) return { ok: false, code: "not_found" };

  const change = liked
    ? db.insert(likes).values({ userId: viewerId, postId }).onConflictDoNothing()
    : db.delete(likes).where(and(eq(likes.userId, viewerId), eq(likes.postId, postId)));
  // The row and the counter change in one batch; counting rows keeps the counter exact however often this runs.
  await db.batch([
    change,
    db.update(posts).set({ likeCount: sql`(select count(*) from ${likes} where ${likes.postId} = ${postId})` }).where(eq(posts.id, postId)),
    // The author's alert is added with the like and taken away with it.
    liked ? alertOnLike(db, viewerId, postId) : removeLikeAlert(db, viewerId, postId),
  ]);

  const after = await db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId)).get();
  return { ok: true, liked, likeCount: after?.likeCount ?? 0 };
}
