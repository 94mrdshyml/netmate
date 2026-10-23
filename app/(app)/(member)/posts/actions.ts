"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { setBookmark } from "@/server/bookmarks";
import { createPost, deletePost, setLike, setRepost } from "@/server/posts";
import { limitLike, limitPost, limitRepost, limitSave, tooManyMessage } from "@/server/rate-limit";
import { isAttachable } from "@/storage/upload";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

const MESSAGES = {
  empty: "Write something first.",
  too_long: "That is over 280 characters.",
  bad_characters: "That text has characters we cannot post.",
  parent_not_found: "That post is not available any more.",
  bad_photos: "One of the pictures could not be used. Remove it and try again.",
  place_too_long: "That place name is over 60 characters.",
  place_bad_characters: "That place name has characters we cannot use.",
  place_off: "Adding a place is turned off here.",
  bad_gif: "That GIF could not be used. Remove it and try another.",
  gif_with_photos: "A post can have pictures or a GIF, not both.",
  gif_off: "GIFs are turned off here.",
  quote_and_reply: "A post can be a reply or a quote, not both.",
  quote_not_found: "That post is not available any more.",
  quote_private: "Posts from a private account cannot be quoted.",
} as const;

export type CreatePostActionResult = { ok: true } | { ok: false; message: string };

/** Posts (then goes Home), or replies when `parentId` is given (then stays, so the page can show the reply). */
export async function createPostAction(input: { body: string; parentId?: string; photos?: string[]; place?: string; gif?: unknown; quote?: string }): Promise<CreatePostActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitPost(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  // Each photo must still exist in storage, be this member's own and really be an image.
  const photos = Array.isArray(input?.photos) ? input.photos : [];
  const attachable = await Promise.all(photos.map((key) => isAttachable(env.MEDIA, member.userId, "post", key)));
  if (!attachable.every(Boolean)) return { ok: false, message: MESSAGES.bad_photos };

  // A place is only taken while the admin has place suggestions on; with it off the button is hidden too.
  const wantsPlace = typeof input?.place === "string" && input.place.trim() !== "";
  if (wantsPlace && !(await readInstance(getDb(env.DB))).settings.placesEnabled) return { ok: false, message: MESSAGES.place_off };

  // A GIF is only taken while the admin has GIF search on. The address itself is checked in createPost.
  if (input?.gif != null && !(await readInstance(getDb(env.DB))).settings.gifsEnabled) return { ok: false, message: MESSAGES.gif_off };

  const result = await createPost(getDb(env.DB), member.userId, input?.body, input?.parentId, photos, input?.place, input?.gif, typeof input?.quote === "string" ? input.quote : undefined);
  if (!result.ok) return { ok: false, message: MESSAGES[result.code] };

  revalidatePath("/");
  if (!input.parentId) redirect("/");
  return { ok: true };
}

export type LikeActionResult = { ok: true; liked: boolean; likeCount: number } | { ok: false; message: string };

/** Sets whether the signed-in member likes a post (the wanted state, not a flip). */
export async function setLikeAction(postId: string, liked: boolean): Promise<LikeActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitLike(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await setLike(getDb(env.DB), member.userId, String(postId), Boolean(liked));
  if (!result.ok) return { ok: false, message: MESSAGES.parent_not_found };
  return result;
}

export type RepostActionResult = { ok: true; reposted: boolean; repostCount: number } | { ok: false; message: string };

const REPOST_MESSAGES = {
  not_found: "That post is not available any more.",
  private: "Posts from a private account cannot be reposted.",
  reply: "Replies cannot be reposted.",
} as const;

/** Sets whether the signed-in member reposts a post (the wanted state, not a flip). */
export async function setRepostAction(postId: string, reposted: boolean): Promise<RepostActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitRepost(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await setRepost(getDb(env.DB), member.userId, String(postId), Boolean(reposted));
  if (!result.ok) return { ok: false, message: REPOST_MESSAGES[result.code] };
  return result;
}

export type BookmarkActionResult = { ok: true; saved: boolean } | { ok: false; message: string };

/** Sets whether the signed-in member has saved a post (the wanted state, not a flip). Private to them. */
export async function setBookmarkAction(postId: string, saved: boolean): Promise<BookmarkActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitSave(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await setBookmark(getDb(env.DB), member.userId, String(postId), Boolean(saved));
  if (!result.ok) return { ok: false, message: "That post is not available any more." };
  return result;
}

/** Deletes the signed-in member's own post. */
export async function deletePostAction(postId: string): Promise<{ ok: boolean }> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const result = await deletePost(getDb(env.DB), member.userId, String(postId));
  revalidatePath("/");
  return { ok: result.ok };
}
