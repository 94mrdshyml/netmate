// Emails about a sign-up's status (docs/PRD.md section 7): the admin hears that someone is waiting,
// and the person hears the answer. None of them can fail the action that caused them: with no
// email set up they are skipped, and a send that fails is recorded for /hq/email and nothing else.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { profiles, user } from "@/db/schema";
import { approvedForInvitee, pendingForAdmin, rejectedForInvitee, type Message } from "@/email/messages";
import { renderEmail } from "@/email/render";
import { pngLogoUrl, siteUrl } from "@/email/template";
import type { SendResult, Transport } from "@/email/transport";
import { readInstance } from "@/instance/settings";
import { isEmailSetUp, sendEmail } from "@/server/email";

export type MailContext = { transport: Transport; encryptionKey: string | undefined; origin: string | undefined };

/** Who to write to, taken before the account can change or disappear. */
export type Contact = { email: string; firstName: string };

/** A Pending person's address and first name, or null when they are not Pending (so nothing is sent). */
export async function pendingContact(db: Db, userId: string): Promise<Contact | null> {
  const row = await db
    .select({ email: user.email, firstName: profiles.firstName })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(and(eq(profiles.userId, userId), eq(profiles.status, "pending")))
    .get();
  return row ?? null;
}

/**
 * Renders a message in the instance's brand and sends it. Never throws: a missing set-up, a bad
 * render or a refused send all come back as `{ ok: false }` for a caller that wants to say so.
 */
export async function deliver(db: Db, ctx: MailContext, to: string, build: (name: string) => Message): Promise<SendResult> {
  try {
    if (!(await isEmailSetUp(db))) return { ok: false, message: "Email is not set up." };
    const { settings } = await readInstance(db);
    const message = build(settings.name);
    const { html, text } = await renderEmail(
      {
        name: settings.name,
        primary: settings.primaryColor,
        radius: settings.radius,
        fontFamily: settings.fontFamily,
        logoUrl: pngLogoUrl(ctx.origin, settings.logoKey),
      },
      message.content,
    );
    return await sendEmail(db, ctx.transport, ctx.encryptionKey, { to, subject: message.subject, html, text });
  } catch {
    // Mail is a courtesy here; the sign-up or the decision has already been saved.
    return { ok: false, message: "The email could not be sent." };
  }
}

/** Tells the admin that this Pending sign-up is waiting. Does nothing for anyone who is not Pending. */
export async function emailAdminOfPending(db: Db, ctx: MailContext, userId: string): Promise<void> {
  try {
    const rows = await db.all<{ adminEmail: string; first: string; last: string; username: string; inviterFirst: string | null; inviterLast: string | null }>(sql`
      select au.email as adminEmail, p.first_name as first, p.last_name as last, p.username as username,
             i.first_name as inviterFirst, i.last_name as inviterLast
      from profiles p
      join profiles a on a.role = 'admin'
      join user au on au.id = a.user_id
      left join profiles i on i.user_id = p.invited_by
      where p.user_id = ${userId} and p.status = 'pending'
      limit 1`);
    const row = rows[0];
    if (!row) return;
    const invitedByName = row.inviterFirst ? `${row.inviterFirst} ${row.inviterLast ?? ""}`.trim() : null;
    await deliver(db, ctx, row.adminEmail, (name) =>
      pendingForAdmin(name, { name: `${row.first} ${row.last}`, username: row.username, invitedByName }, siteUrl(ctx.origin, "/hq/approvals")),
    );
  } catch {
    // See deliver: nothing here may break a sign-up.
  }
}

export async function emailApproved(db: Db, ctx: MailContext, who: Contact): Promise<void> {
  await deliver(db, ctx, who.email, (name) => approvedForInvitee(name, who.firstName, siteUrl(ctx.origin, "/sign-in")));
}

export async function emailRejected(db: Db, ctx: MailContext, who: Contact): Promise<void> {
  await deliver(db, ctx, who.email, (name) => rejectedForInvitee(name, who.firstName));
}
