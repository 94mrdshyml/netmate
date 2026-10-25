// The email to the person who reported a post when their case is closed (docs/PRD.md section 8.8a). Like every status email
// it can never fail the action that caused it: with no email set up it is skipped, and a failed send is only recorded for
// /hq/email. Addresses are read here, used once, and never logged.

import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { reportClosedForReporter } from "@/email/messages";
import { siteUrl } from "@/email/template";
import { formatCaseId, outcomeLabel } from "@/lib/report-categories";
import { deliver, type MailContext } from "@/server/status-emails";

/** Emails whoever reported each of these cases (by case number). Does nothing for a case that is not closed or whose reporter has left. */
export async function emailReportersOfCases(db: Db, ctx: MailContext, caseNos: number[]): Promise<void> {
  for (const caseNo of caseNos.slice(0, 50)) {
    try {
      const [row] = await db.all<{ email: string; first: string; outcome: string | null }>(sql`
        select u.email as email, p.first_name as first, r.outcome as outcome
        from reports r
        join user u on u.id = r.reporter_id
        join profiles p on p.user_id = r.reporter_id
        where r.case_no = ${caseNo} and r.status = 'closed' and p.status = 'active'
        limit 1`);
      if (!row) continue;
      const report = { caseId: formatCaseId(caseNo), outcome: outcomeLabel(row.outcome) };
      await deliver(db, ctx, row.email, (name) => reportClosedForReporter(name, row.first, report, siteUrl(ctx.origin, "/reports")));
    } catch {
      // A courtesy: the case is already closed.
    }
  }
}
