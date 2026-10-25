"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { transportFor } from "@/email/transport";
import { pngLogoUrl } from "@/email/template";
import { removeEmailSettings, saveEmailSettings, sendTestEmail, type SaveEmailResult } from "@/server/email";
import { limitPolarTest, limitTestEmail, tooManyMessage } from "@/server/rate-limit";
import { getInstanceState } from "@/instance/request";
import { saveBrandingForm, type BrandingResult } from "@/instance/branding";
import { clearInstanceCache } from "@/instance/settings";
import { DEMO_STEPS, removeDemo, runDemoStep, type Removed } from "@/demo/seed";
import { isId } from "@/lib/ids";
import { setModerator } from "@/server/members";
import { removePaymentKeys, savePaymentConnection, savePaymentSplit, savePolarFee, setPaymentsEnabled, testPolar, type SaveResult, type TestResult } from "@/server/payments";
import { recordPayout, voidPayout } from "@/server/revenue";
import { emailReportersOfCases } from "@/server/case-mail";
import { liftSuspension, removePostFromCase, suspendMember, type RemoveResult, type SuspendResult } from "@/server/moderation";
import { closeCase, reopenCase, startReview, type CaseChange } from "@/server/reports";
import { removeKlipyKey, saveKlipyKey, type SaveKlipyResult } from "@/server/gifs";
import { approvePending, regenerateInvite, rejectPending, setInviteQuota, setLinkPreviewsEnabled, setPlacesEnabled } from "@/server/admin";
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

export type ServicesResult = { ok: true; enabled: boolean } | { ok: false; message: string };

/** Turns place suggestions on or off. Clears the settings cache so the composer follows at once. */
export async function savePlacesAction(wanted: unknown): Promise<ServicesResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await setPlacesEnabled(getDb(env.DB), wanted);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/hq/services");
    revalidatePath("/compose");
  }
  return result;
}

/**
 * Saves the Klipy key and turns GIF search on. The admin's own browser has already tried the key with Klipy
 * (Klipy wants every request from a browser), so this only checks its shape and stores it encrypted.
 */
export async function saveKlipyKeyAction(input: unknown): Promise<SaveKlipyResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await saveKlipyKey(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, input);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/hq/services");
    revalidatePath("/compose");
  }
  return result;
}

/** Forgets the Klipy key and turns GIF search off. GIFs already on posts stay. */
export async function removeKlipyKeyAction(): Promise<{ ok: boolean }> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const ok = await removeKlipyKey(getDb(env.DB));
  if (ok) {
    clearInstanceCache();
    revalidatePath("/hq/services");
    revalidatePath("/compose");
  }
  return { ok };
}

/** Turns link previews on or off. Clears the settings cache so the composer follows at once. */
export async function saveLinkPreviewsAction(wanted: unknown): Promise<ServicesResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await setLinkPreviewsEnabled(getDb(env.DB), wanted);
  if (result.ok) {
    clearInstanceCache();
    revalidatePath("/hq/services");
    revalidatePath("/compose");
  }
  return result;
}

// ---- Demo data (owner decision, session 45): invented people and posts, added and removed from /hq/demo. ----

export type DemoStepResult = { ok: true; base: number; last: boolean } | { ok: false; message: string };

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Runs one step of adding the demo people (0 for the first, then on). One request may only make so many calls to
 * the database, so the page asks step by step; a step that stopped can be run again. The people it adds have no
 * sign-in, so nobody can use their accounts.
 */
export async function demoStepAction(step: unknown, base: unknown): Promise<DemoStepResult> {
  await requireAdmin();
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step >= DEMO_STEPS) {
    return { ok: false, message: "That step does not exist. Reload the page and try again." };
  }
  const now = Date.now();
  // Step 0 starts the run; the rest carry on from the moment it started.
  if (step > 0 && (typeof base !== "number" || !Number.isFinite(base) || base > now + 60_000 || base < now - SIX_HOURS)) {
    return { ok: false, message: "That run is too old to carry on. Press the button again." };
  }
  const started = step === 0 ? now : (base as number);
  try {
    const { env } = await getCloudflareContext({ async: true });
    await runDemoStep({ db: getDb(env.DB), d1: env.DB, media: env.MEDIA }, step, started);
  } catch (error) {
    // Only the reason, never anything a person typed.
    console.error("demo step failed", step, error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: `Something went wrong at step ${step + 1} of ${DEMO_STEPS}. Nothing is lost: press the button again to carry on.` };
  }
  revalidatePath("/hq/demo");
  return { ok: true, base: started, last: step === DEMO_STEPS - 1 };
}

export type RemoveDemoResult = { ok: true; removed: Removed } | { ok: false; message: string };

/** Takes every demo person away, with their posts, pictures, likes and alerts. Real members and their own posts are not touched. */
export async function removeDemoAction(): Promise<RemoveDemoResult> {
  await requireAdmin();
  try {
    const { env } = await getCloudflareContext({ async: true });
    const removed = await removeDemo({ db: getDb(env.DB), d1: env.DB, media: env.MEDIA });
    revalidatePath("/hq/demo");
    return { ok: true, removed };
  } catch (error) {
    console.error("removing demo data failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: "Something went wrong and the demo data may be only partly removed. Press the button again." };
  }
}

// ---- Moderators (owner decision, session 46): only the admin makes or removes one. ----

/** Makes a member a moderator (`wanted` is "1") or takes it back. Sending the same thing twice changes nothing. */
export async function setModeratorAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  await setModerator(getDb(env.DB), String(formData.get("userId") ?? ""), formData.get("wanted") === "1");
  revalidatePath("/hq/members");
}

// ---- Report cases (owner decision, session 48): the admin and the moderators work them. ----

export type CaseActionResult = { ok: true } | { ok: false; message: string };

const CASE_MESSAGES = {
  not_found: "That case is not available.",
  bad_outcome: "Choose how it ended.",
  note_too_long: "Keep the note to 500 characters or fewer.",
  bad_note: "That note has characters we cannot use.",
} as const;

async function staffAndDb() {
  const member = await requireStaff();
  const { env } = await getCloudflareContext({ async: true });
  return { staff: { userId: member.userId, isAdmin: member.role === "admin" }, db: getDb(env.DB) };
}

function finish(result: CaseChange): CaseActionResult {
  revalidatePath("/hq", "layout");
  return result.ok ? { ok: true } : { ok: false, message: CASE_MESSAGES[result.code] };
}

/** Takes an open case. Taking one that is already taken changes nothing. */
export async function startReviewAction(caseNo: number): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  return finish(await startReview(db, staff, caseNo));
}

/** Closes a case with how it ended and an optional note. Closing one that is already closed changes nothing. */
export async function closeCaseAction(caseNo: number, outcome: string, note: string): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  const result = await closeCase(db, staff, caseNo, outcome, note);
  // The person who reported it is emailed once, only when this press really closed the case.
  if (result.ok && result.changed && result.status === "closed") {
    const { env } = await getCloudflareContext({ async: true });
    await emailReportersOfCases(db, mailContext(env), [Number(caseNo)]);
  }
  return finish(result);
}

const REMOVE_MESSAGES = {
  not_found: "That case is not available.",
  gone: "That post is already gone.",
  owner: "The owner's posts cannot be taken down from here.",
  moderator: "Only the admin can take down a moderator's post.",
  bad_note: "That note has characters we cannot use.",
  note_too_long: "Keep the note to 500 characters or fewer.",
} as const satisfies Record<Extract<RemoveResult, { ok: false }>["code"], string>;

/** Takes down the post a case is about, closes every open case on it, and tells the author and the reporters. */
export async function removePostAction(caseNo: number, note: string): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  const result = await removePostFromCase(db, staff, caseNo, note);
  revalidatePath("/hq", "layout");
  revalidatePath("/");
  if (!result.ok) return { ok: false, message: REMOVE_MESSAGES[result.code] };
  const { env } = await getCloudflareContext({ async: true });
  await emailReportersOfCases(db, mailContext(env), result.closed);
  return { ok: true };
}

const SUSPEND_MESSAGES = {
  not_found: "That member is not available.",
  self: "You cannot do that to yourself.",
  owner: "The owner cannot be suspended.",
  moderator: "Only the admin can suspend a moderator.",
  not_active: "Only an active member can be suspended.",
  bad_note: "That note has characters we cannot use.",
  note_too_long: "Keep the note to 500 characters or fewer.",
} as const satisfies Record<Extract<SuspendResult, { ok: false }>["code"], string>;

function suspension(result: SuspendResult): CaseActionResult {
  revalidatePath("/hq/members");
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : { ok: false, message: SUSPEND_MESSAGES[result.code] };
}

/** Suspends a member: signed out at once, cannot sign in, hidden from everyone but staff until lifted. */
export async function suspendMemberAction(userId: string, note: string): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  return suspension(await suspendMember(db, staff, userId, note));
}

/** Lifts a suspension. */
export async function liftSuspensionAction(userId: string): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  return suspension(await liftSuspension(db, staff, userId));
}

/** Opens a closed case again. */
export async function reopenCaseAction(caseNo: number): Promise<CaseActionResult> {
  const { staff, db } = await staffAndDb();
  return finish(await reopenCase(db, staff, caseNo));
}

// ---- Payments (owner decision, session 49): the owner connects Polar and sets the split. Admin only. ----

/** Saves the mode and, when pasted, a new Polar access token and webhook secret. A blank box keeps what is saved. */
export async function savePaymentConnectionAction(input: { mode: string; accessToken: string; webhookSecret: string }): Promise<SaveResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await savePaymentConnection(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, input);
  if (result.ok) revalidatePath("/hq/money/setup");
  return result;
}

/** Saves the share of each payment that goes to the member (a whole percent). */
export async function savePaymentSplitAction(percent: string): Promise<SaveResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await savePaymentSplit(getDb(env.DB), percent);
  if (result.ok) revalidatePath("/hq/money/setup");
  return result;
}

/** Turns subscriptions on or off for the whole space. Turning on needs both keys saved. */
export async function setPaymentsEnabledAction(wanted: boolean): Promise<SaveResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await setPaymentsEnabled(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, wanted);
  if (result.ok) {
    revalidatePath("/hq/money/setup");
    revalidatePath("/settings");
  }
  return result;
}

/** Forgets the Polar token and webhook secret. */
export async function removePaymentKeysAction(): Promise<{ ok: boolean }> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const ok = await removePaymentKeys(getDb(env.DB));
  if (ok) revalidatePath("/hq/money/setup");
  return { ok };
}

/** Asks Polar once with the saved token. Limited to 10 an hour. */
export async function testPolarAction(): Promise<TestResult> {
  const admin = await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const limited = await limitPolarTest(env.DB, env.AUTH_SECRET, admin.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };
  return testPolar(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);
}

/** Saves Polar's fee as entered from the owner's Polar plan, for the owner's estimate of what is left. */
export async function savePolarFeeAction(percent: string, fixed: string): Promise<SaveResult> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await savePolarFee(getDb(env.DB), percent, fixed);
  if (result.ok) revalidatePath("/hq/money/setup");
  return result;
}

// ---- Revenue (owner decision, session 54): the owner records payouts to members by hand. Admin only. ----

export type PayoutActionResult = { ok: true } | { ok: false; message: string };

/** Records that the owner paid a member. Never more than they are owed. */
export async function recordPayoutAction(creatorId: string, amount: string, note: string): Promise<PayoutActionResult> {
  const admin = await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const result = await recordPayout(getDb(env.DB), admin.userId, creatorId, amount, note);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/hq/money/payouts");
  revalidatePath("/subscriptions/earnings");
  return { ok: true };
}

/** Takes back a payout recorded by mistake (it stays on record as voided). */
export async function voidPayoutAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  await voidPayout(getDb(env.DB), String(formData.get("id") ?? ""));
  revalidatePath("/hq/money/payouts");
  revalidatePath("/subscriptions/earnings");
}
