// Inviting a person by email (docs/PRD.md section 6): a member types an address and the invitation
// goes out with their own invite link. The address is used to send and to rate-limit (as a salted
// hash) and is never stored or logged. Nobody is told whether the address already belongs to a
// member, so this cannot be used to find out who is in the community.

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { user } from "@/db/schema";
import { inviteByEmail } from "@/email/messages";
import { siteUrl } from "@/email/template";
import { isEmailSetUp } from "@/server/email";
import { inviteUrl } from "@/server/invites";
import { limitInviteEmail, tooManyMessage } from "@/server/rate-limit";
import { deliver, type MailContext } from "@/server/status-emails";

const emailSchema = z.string().trim().toLowerCase().max(254, "That address is too long").pipe(z.email("Enter a valid email address"));

export type InviteEmailFailure = "invalid" | "own" | "not_set_up" | "rate_limited" | "failed";
export type InviteEmailResult = { ok: true } | { ok: false; code: InviteEmailFailure; message: string };

const fail = (code: InviteEmailFailure, message: string): InviteEmailResult => ({ ok: false, code, message });

export async function sendInviteEmail(
  db: Db,
  d1: D1Database,
  ctx: MailContext & { salt: string },
  inviter: { userId: string; name: string; email: string },
  link: { code: string },
  rawEmail: unknown,
): Promise<InviteEmailResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Enter a valid email address");
  const to = parsed.data;
  if (to === inviter.email.toLowerCase()) return fail("own", "That is your own address.");

  if (!(await isEmailSetUp(db))) return fail("not_set_up", "Email is not set up, so share your link by hand.");
  const base = siteUrl(ctx.origin, "");
  const joinUrl = base ? inviteUrl(base, link.code) : null;
  if (!joinUrl) return fail("failed", "Could not make the invitation. Share your link by hand.");

  const limited = await limitInviteEmail(d1, ctx.salt, { userId: inviter.userId, to });
  if (!limited.ok) return fail("rate_limited", tooManyMessage(limited.retryAfterSeconds));

  // A person who already has an account is not emailed, and is not told apart from anyone else.
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, to)).get();
  if (existing) return { ok: true };

  const result = await deliver(db, ctx, to, (name) => inviteByEmail(name, inviter.name, joinUrl));
  return result.ok ? { ok: true } : fail("failed", "Could not send that email. Try again later, or share your link by hand.");
}
