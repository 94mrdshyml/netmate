import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { outcomeLabel } from "@/lib/report-categories";
import { currentTime, relativeTime } from "@/lib/time";
import { CASE_FILTERS, listCases, type CaseFilter } from "@/server/reports";
import { EmptyState } from "../../(member)/_components/empty-state";
import { Icon } from "../../(member)/_components/icon";
import { Card, PageHeader, Pill, Toolbar } from "../hq-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports" };

const FILTER_LABEL: Record<CaseFilter, string> = { open: "Open", reviewing: "In review", closed: "Closed" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function href(query: string, show: CaseFilter, after?: string | null) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (show !== "open") params.set("show", show);
  if (after) params.set("after", after);
  const text = params.toString();
  return text ? `/hq/cases?${text}` : "/hq/cases";
}

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; show?: string | string[]; after?: string | string[] }> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const query = (one(params.q) ?? "").trim().slice(0, 50);
  const show = (CASE_FILTERS as readonly string[]).includes(one(params.show) ?? "") ? (one(params.show) as CaseFilter) : "open";

  const { env } = await getCloudflareContext({ async: true });
  const page = await listCases(getDb(env.DB), { userId: staff.userId, isAdmin: staff.role === "admin" }, { filter: show, query, cursor: one(params.after) });
  const now = currentTime();

  return (
    <>
      <PageHeader title="Reports">
        Every report is a case with its own number. Take a case, look into it, then close it with how it ended. The person who wrote the post is never told.
      </PageHeader>

      <Card id="cases-heading" icon="flag" title="Cases">
        <Toolbar>
        <form className="hq-inline" role="search" action="/hq/cases" method="get">
          <div className="field hq-inline-field">
            <label htmlFor="case-search">Find a case</label>
            <input id="case-search" className="input" name="q" type="search" defaultValue={query} maxLength={50} placeholder="CASE-000123, or words from the post" autoComplete="off" />
          </div>
          {show !== "open" ? <input type="hidden" name="show" value={show} /> : null}
          <button type="submit" className="btn btn-primary">
            <Icon name="search" size={18} />
            Search
          </button>
        </form>

        <nav className="hq-filters" aria-label="Show">
          {CASE_FILTERS.map((f) => (
            <Link key={f} href={href(query, f)} className="hq-chip" aria-current={show === f ? "true" : undefined}>
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </nav>
        </Toolbar>

        {page.items.length === 0 ? (
          <EmptyState icon="inbox" title={query ? "No case matches." : show === "open" ? "Nothing is waiting." : "Nothing here."}>
            {query ? "Try the case number, or other words from the post." : show === "open" ? "When someone reports a post it shows up here." : "Cases move here as they are taken and closed."}
          </EmptyState>
        ) : (
          <ul className="hq-list" aria-label="Cases">
            {page.items.map((c) => (
              <li key={c.caseNo} className="hq-item">
                <div className="hq-item-text">
                  <Link href={`/hq/cases/${c.caseNo}`} className="case-link">
                    <strong className="case-id">{c.caseId}</strong>
                  </Link>{" "}
                  <Pill tone={c.status === "open" ? "attention" : "quiet"}>
                    {c.status === "open" ? "Open" : c.status === "reviewing" ? "In review" : outcomeLabel(c.outcome)}
                  </Pill>{" "}
                  <Pill>{c.categoryLabel}</Pill>
                  <div>{c.excerpt || "A post with a picture."}</div>
                  <div className="hq-meta">
                    @{c.authorUsername} · reported by {c.reporterName ?? "someone who has left"} · {relativeTime(c.createdAt, now)}
                    {c.handledByName ? ` · ${c.handledByName}` : ""}
                  </div>
                </div>
                <div className="hq-item-actions">
                  <Link href={`/hq/cases/${c.caseNo}`} className="btn btn-ghost" aria-label={`Open ${c.caseId}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {page.nextCursor ? (
          <p className="hq-more">
            <Link href={href(query, show, page.nextCursor)} className="btn btn-ghost">
              Show more cases
            </Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}
