"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { setFollow } from "@/server/follows";
import { limitFollow, tooManyMessage } from "@/server/rate-limit";
import { updateProfile, type EditProfileResult } from "@/server/profiles";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

export type FollowActionResult = { ok: true; following: boolean } | { ok: false; message: string };

/** Sets whether the signed-in member follows someone (the wanted state, not a flip). */
export async function setFollowAction(userId: string, following: boolean): Promise<FollowActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitFollow(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await setFollow(getDb(env.DB), member.userId, String(userId), Boolean(following));
  if (!result.ok) {
    return { ok: false, message: result.code === "self" ? "You cannot follow yourself." : "That person is not available." };
  }
  revalidatePath(`/${member.username}`);
  return result;
}

export type EditProfileActionResult = EditProfileResult;

/** Saves the signed-in member's own profile. */
export async function updateProfileAction(input: unknown): Promise<EditProfileActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const result = await updateProfile(getDb(env.DB), member.userId, input);
  if (result.ok) {
    revalidatePath(`/${member.username}`);
    revalidatePath("/");
  }
  return result;
}
