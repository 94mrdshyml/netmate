import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { outcomeLabel } from "@/lib/report-categories";
import { currentTime, relativeTime } from "@/lib/time";
import { listMyReports } from "@/server/reports";
import { EmptyState } from "../_components/empty-state";
import { PageHeader } from "../_components/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your reports" };

const STATUS = { open: "Waiting", reviewing: "Being looked at", closed: "Closed" } as const;

export default async function MyReportsPage() {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { env } = await getCloudflareContext({ async: true });
  const mine = await listMyReports(getDb(env.DB), member.userId);
  const now = currentTime();

  return (
    <main className="column">
      <PageHeader title="Your reports" back={{ href: "/settings", label: "Back to Settings" }} centered />
      <p className="hint">Only you and the people who look after this space can see these. The person you reported is never told.</p>

      {mine.length === 0 ? (
        <EmptyState icon="flag" title="You have not reported anything.">
          If a post is not right, tap the three dots under it and choose Report post.
        </EmptyState>
      ) : (
        <ul className="case-list" aria-label="Your reports">
          {mine.map((r) => (
            <li key={r.caseNo} className="case-row">
              <p className="case-row-top">
                <strong className="case-id">{r.caseId}</strong>
                <span className={r.status === "closed" ? "case-state" : "case-state case-state-live"}>
                  {r.status === "closed" ? `Closed: ${outcomeLabel(r.outcome)}` : STATUS[r.status]}
                </span>
              </p>
              <p className="case-row-kind">{r.categoryLabel}</p>
              <p className="case-row-excerpt">{r.excerpt || "A post with a picture."}</p>
              <p className="muted case-row-when">{relativeTime(r.createdAt, now)}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
