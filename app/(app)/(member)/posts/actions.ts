"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { createPost, deletePost, setLike } from "@/server/posts";
import { limitLike, limitPost, tooManyMessage } from "@/server/rate-limit";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

const MESSAGES = {
  empty: "Write something first.",
  too_long: "That is over 280 characters.",
  bad_characters: "That text has characters we cannot post.",
  parent_not_found: "That post is not available any more.",
} as const;

export type CreatePostActionResult = { ok: true } | { ok: false; message: string };

/** Posts (then goes Home), or replies when `parentId` is given (then stays, so the page can show the reply). */
export async function createPostAction(input: { body: string; parentId?: string }): Promise<CreatePostActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitPost(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await createPost(getDb(env.DB), member.userId, input?.body, input?.parentId);
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
