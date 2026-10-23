// Forgot and reset password (docs/PRD.md sections 5 and 7). Better Auth makes and checks the
// one-time token; this file sends the email, writes the link and checks a link before the form
// is shown. Asking for a link never says whether the address belongs to a member, and the email
// is sent after the response, so a known and an unknown address look and feel the same.

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { RESET_LINK_SECONDS, type Auth } from "@/auth";
import type { Db } from "@/db";
import { verification } from "@/db/schema";
import { passwordReset } from "@/email/messages";
import { siteUrl } from "@/email/template";
import { isEmailSetUp } from "@/server/email";
import { deliver, type MailContext } from "@/server/status-emails";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** The function Better Auth calls with a fresh token for a real member. */
export function resetEmailSender(db: Db, ctx: MailContext) {
  return async ({ user, token }: { user: { email: string; name: string }; token: string }): Promise<void> => {
    const url = siteUrl(ctx.origin, `/reset-password?token=${encodeURIComponent(token)}`);
    if (!url) return;
    const firstName = user.name.trim().split(/\s+/)[0] ?? "there";
    await deliver(db, ctx, user.email, (name) => passwordReset(name, firstName, url, Math.round(RESET_LINK_SECONDS / 60)));
  };
}

export type ResetRequestResult = { ok: true } | { ok: false; code: "invalid" | "not_set_up"; message: string };

/**
 * Asks for a reset link. Returns the same answer for an address that belongs to a member and one
 * that does not. The auth object must have been made with `resetEmailSender` for mail to go out.
 */
export async function requestPasswordReset(auth: Pick<Auth, "api">, db: Db, rawEmail: unknown): Promise<ResetRequestResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Enter a valid email address" };
  if (!(await isEmailSetUp(db))) return { ok: false, code: "not_set_up", message: "Password reset is not available because email is not set up." };
  try {
    await auth.api.requestPasswordReset({ body: { email: parsed.data } });
  } catch {
    // Whatever went wrong is not shown: the answer must not depend on the address.
  }
  return { ok: true };
}

/** Whether a reset link's token is real and has not run out or been used. Used before the form is shown. */
export async function resetTokenIsLive(db: Db, token: unknown, now: Date = new Date()): Promise<boolean> {
  if (typeof token !== "string" || token.length < 8 || token.length > 100) return false;
  const row = await db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.identifier, `reset-password:${token}`), gt(verification.expiresAt, now)))
    .get();
  return Boolean(row);
}

const newPasswordSchema = z.object({
  token: z.string().min(8).max(100),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use 128 characters or fewer"),
});

export type ResetResult = { ok: true } | { ok: false; code: "invalid" | "expired" | "failed"; message: string };

/** Sets the new password with the link's token. The token works once; every other session is ended. */
export async function resetPasswordWithToken(auth: Pick<Auth, "api">, db: Db, raw: unknown): Promise<ResetResult> {
  const parsed = newPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const tokenBad = parsed.error.issues.some((i) => i.path[0] === "token");
    return tokenBad
      ? { ok: false, code: "expired", message: "This link is not valid any more. Ask for a new one." }
      : { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Choose a different password" };
  }
  if (!(await resetTokenIsLive(db, parsed.data.token))) {
    return { ok: false, code: "expired", message: "This link is not valid any more. Ask for a new one." };
  }
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token } });
    return { ok: true };
  } catch {
    // A token used a moment ago by another request, or one that expired in between.
    return { ok: false, code: "expired", message: "This link is not valid any more. Ask for a new one." };
  }
}
