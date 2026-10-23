"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { createPost, deletePost, setLike } from "@/server/posts";
import { limitLike, limitPost, tooManyMessage } from "@/server/rate-limit";
import { isAttachable } from "@/storage/upload";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

const MESSAGES = {
  empty: "Write something first.",
  too_long: "That is over 280 characters.",
  bad_characters: "That text has characters we cannot post.",
  parent_not_found: "That post is not available any more.",
  bad_photos: "One of the pictures could not be used. Remove it and try again.",
} as const;

export type CreatePostActionResult = { ok: true } | { ok: false; message: string };

/** Posts (then goes Home), or replies when `parentId` is given (then stays, so the page can show the reply). */
export async function createPostAction(input: { body: string; parentId?: string; photos?: string[] }): Promise<CreatePostActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitPost(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  // Each photo must still exist in storage, be this member's own and really be an image.
  const photos = Array.isArray(input?.photos) ? input.photos : [];
  const attachable = await Promise.all(photos.map((key) => isAttachable(env.MEDIA, member.userId, "post", key)));
  if (!attachable.every(Boolean)) return { ok: false, message: MESSAGES.bad_photos };

  const result = await createPost(getDb(env.DB), member.userId, input?.body, input?.parentId, photos);
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

/** Deletes the signed-in member's own post. */
export async function deletePostAction(postId: string): Promise<{ ok: boolean }> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const result = await deletePost(getDb(env.DB), member.userId, String(postId));
  revalidatePath("/");
  return { ok: result.ok };
}
