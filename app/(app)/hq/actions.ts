"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { transportFor } from "@/email/transport";
import { pngLogoUrl } from "@/email/template";
import { removeEmailSettings, saveEmailSettings, sendTestEmail, type SaveEmailResult } from "@/server/email";
import { limitTestEmail, tooManyMessage } from "@/server/rate-limit";
import { getInstanceState } from "@/instance/request";
import { saveBrandingForm, type BrandingResult } from "@/instance/branding";
import { clearInstanceCache } from "@/instance/settings";
import { isId } from "@/lib/ids";
import { approvePending, regenerateInvite, rejectPending, setInviteQuota } from "@/server/admin";
import { emailApproved, emailRejected, pendingContact } from "@/server/status-emails";
import { mailContext } from "@/server/mail-context";

// Every action checks the admin itself, on the server, each time (CLAUDE.md hard rule 3). The
// browser sends only the id of the thing to act on; who is asking comes from the session.

/** Approves one Pending sign-up. Doing it twice, or on someone already active, changes nothing. */
export async function approveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!isId("user", userId)) return;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const contact = await pendingContact(db, userId);
  const result = await approvePending(db, userId);
  // Only the request that really approved them sends the email, so a repeat click sends nothing.
  if (result.ok && contact) await emailApproved(db, mailContext(env), contact);
  revalidatePath("/hq", "layout");
}

/** Rejects one Pending sign-up by deleting the account. Never touches an active member. */
export async function rejectAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!isId("user", userId)) return;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  // The account is deleted, so the address is read first.
  const contact = await pendingContact(db, userId);
  const result = await rejectPending(db, userId);
  if (result.ok && contact) await emailRejected(db, mailContext(env), contact);
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
  const result = await saveBrandingForm(getDb(env.DB), env.MEDIA, input);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/", "layout");
  }
  return result;
}

/** Saves the Resend key (checked with a real call) and the sender address. The key is never sent back. */
export async function saveEmailAction(input: unknown): Promise<SaveEmailResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await saveEmailSettings(getDb(env.DB), transportFor(env), env.SETTINGS_ENCRYPTION_KEY, input);
  if (result.ok) revalidatePath("/hq", "layout");
  return result;
}

/** Forgets the Resend key and sender. */
export async function removeEmailAction(): Promise<{ ok: boolean }> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const ok = await removeEmailSettings(getDb(env.DB));
  revalidatePath("/hq", "layout");
  return { ok };
}

export type TestEmailResult = { ok: true } | { ok: false; message: string };

/** Sends a test email to the admin's own address. Five an hour. */
export async function sendTestEmailAction(): Promise<TestEmailResult> {
  const admin = await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);

  const limited = await limitTestEmail(env.DB, env.AUTH_SECRET, admin.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const { settings } = await getInstanceState();
  const result = await sendTestEmail(
    db,
    transportFor(env),
    env.SETTINGS_ENCRYPTION_KEY,
    {
      name: settings.name,
      primary: settings.primaryColor,
      radius: settings.radius,
      fontFamily: settings.fontFamily,
      logoUrl: pngLogoUrl(env.BETTER_AUTH_URL, settings.logoKey),
    },
    admin.email,
  );
  revalidatePath("/hq/email");
  return result;
}
