"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { answerFollowRequest, setBlock, setMute, setPrivate } from "@/server/privacy";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).
// Each sends the wanted state, so sending it twice changes nothing.

export type PrivacyActionResult = { ok: true } | { ok: false; message: string };

const UNAVAILABLE = "That person is not available.";

/** Makes the signed-in member's account private or public. Going public approves everyone waiting. */
export async function setPrivateAction(wanted: boolean): Promise<PrivacyActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  await setPrivate(getDb(env.DB), member.userId, Boolean(wanted));
  revalidatePath("/privacy");
  revalidatePath(`/${member.username}`);
  return { ok: true };
}

/** Approves or declines one follow request. */
export async function answerRequestAction(requesterId: string, approve: boolean): Promise<PrivacyActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const result = await answerFollowRequest(getDb(env.DB), member.userId, String(requesterId), Boolean(approve));
  if (!result.ok) return { ok: false, message: UNAVAILABLE };
  // No revalidatePath here: any call re-draws the page you are on, and the row would vanish before it
  // could say "Approved". Every Privacy screen is drawn fresh on each visit anyway.
  return { ok: true };
}

/** Blocks or unblocks someone. */
export async function setBlockAction(userId: string, blocked: boolean): Promise<PrivacyActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const result = await setBlock(getDb(env.DB), member.userId, String(userId), Boolean(blocked));
  if (!result.ok) return { ok: false, message: result.code === "self" ? "You cannot block yourself." : UNAVAILABLE };
  return { ok: true };
}

/** Mutes or unmutes someone. */
export async function setMuteAction(userId: string, muted: boolean): Promise<PrivacyActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const result = await setMute(getDb(env.DB), member.userId, String(userId), Boolean(muted));
  if (!result.ok) return { ok: false, message: result.code === "self" ? "You cannot mute yourself." : UNAVAILABLE };
  return { ok: true };
}
