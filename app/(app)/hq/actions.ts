"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { saveBranding, type BrandingResult } from "@/instance/branding";
import { clearInstanceCache } from "@/instance/settings";
import { isId } from "@/lib/ids";
import { approvePending, regenerateInvite, rejectPending, setInviteQuota } from "@/server/admin";

// Every action checks the admin itself, on the server, each time (CLAUDE.md hard rule 3). The
// browser sends only the id of the thing to act on; who is asking comes from the session.

/** Approves one Pending sign-up. Doing it twice, or on someone already active, changes nothing. */
export async function approveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!isId("user", userId)) return;
  const { env } = await getCloudflareContext({ async: true });
  await approvePending(getDb(env.DB), userId);
  revalidatePath("/hq", "layout");
}

/** Rejects one Pending sign-up by deleting the account. Never touches an active member. */
export async function rejectAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!isId("user", userId)) return;
  const { env } = await getCloudflareContext({ async: true });
  await rejectPending(getDb(env.DB), userId);
  revalidatePath("/hq", "layout");
}

/** Replaces a member's invite link with a new code. */
export async function regenerateInviteAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const linkId = String(formData.get("linkId") ?? "");
  if (!isId("inviteLink", linkId)) return;
  const { env } = await getCloudflareContext({ async: true });
  await regenerateInvite(getDb(env.DB), env.DB, linkId);
  revalidatePath("/hq/invites");
}

export type QuotaResult = { ok: true; quota: number } | { ok: false; message: string };

/** Saves how many sign-ups each member link auto-approves. */
export async function saveQuotaAction(input: unknown): Promise<QuotaResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await setInviteQuota(getDb(env.DB), input);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/hq/invites");
  }
  return result;
}

/** Saves the instance name and look. Clears the settings cache so every page picks it up. */
export async function saveBrandingAction(input: unknown): Promise<BrandingResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await saveBranding(getDb(env.DB), input);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/", "layout");
  }
  return result;
}
