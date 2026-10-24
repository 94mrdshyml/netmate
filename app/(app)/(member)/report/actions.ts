"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { REPORT_NOTE_MAX } from "@/lib/report-categories";
import { limitReport, tooManyMessage } from "@/server/rate-limit";
import { fileReport } from "@/server/reports";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

const MESSAGES = {
  not_found: "That post is not available any more.",
  own_post: "You cannot report your own post. You can delete it instead.",
  bad_category: "Choose what is wrong with the post.",
  note_required: "Tell us what is wrong, in a few words.",
  note_too_long: `Keep it to ${REPORT_NOTE_MAX} characters or fewer.`,
  bad_note: "That text has characters we cannot use.",
} as const;

export type ReportActionResult = { ok: true; caseId: string; already: boolean } | { ok: false; message: string };

/** Reports a post the signed-in member can see. Sending it twice gives back the same case. */
export async function fileReportAction(postId: string, category: string, note: string): Promise<ReportActionResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitReport(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await fileReport(getDb(env.DB), member.userId, postId, category, note);
  if (!result.ok) return { ok: false, message: MESSAGES[result.code] };
  return { ok: true, caseId: result.caseId, already: result.already };
}
