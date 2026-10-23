"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { countUnreadAlerts, markAllAlertsRead } from "@/server/notifications";

// Every action checks the session itself and takes the person from it, never from the browser (CLAUDE.md rule 5).

/** Marks every alert of the signed-in member as read. Repeating it changes nothing. */
export async function markAlertsReadAction(): Promise<void> {
  const member = await getMember();
  if (!member) return;
  const { env } = await getCloudflareContext({ async: true });
  await markAllAlertsRead(getDb(env.DB), member.userId);
}

/** How many unread alerts the signed-in member has, for the badge on the bottom bar. */
export async function unreadAlertCountAction(): Promise<number> {
  const member = await getMember();
  if (!member) return 0;
  const { env } = await getCloudflareContext({ async: true });
  return countUnreadAlerts(getDb(env.DB), member.userId);
}
