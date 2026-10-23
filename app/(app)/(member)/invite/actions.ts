"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { transportFor } from "@/email/transport";
import { sendInviteEmail, type InviteEmailResult } from "@/server/invite-email";
import { ensureInviteLink } from "@/server/invites";
import { siteOrigin } from "@/server/origin";

// Checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5). The
// invitation always carries the signed-in member's own link.

export type InviteEmailActionResult = InviteEmailResult;

export async function sendInviteEmailAction(input: unknown): Promise<InviteEmailActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);

  const link = await ensureInviteLink(db, member.userId);
  const address = typeof input === "object" && input !== null ? (input as { email?: unknown }).email : undefined;
  return sendInviteEmail(
    db,
    env.DB,
    {
      transport: transportFor(env),
      encryptionKey: env.SETTINGS_ENCRYPTION_KEY,
      origin: siteOrigin(env, await headers()),
      salt: env.AUTH_SECRET,
    },
    { userId: member.userId, name: `${member.firstName} ${member.lastName}`, email: member.email },
    link,
    address,
  );
}
