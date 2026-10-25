import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { outcomeLabel } from "@/lib/report-categories";
import { getCase } from "@/server/reports";
import { Icon } from "../../../(member)/_components/icon";
import { Card, PageHeader, Pill } from "../../hq-ui";
import { CaseActions } from "./case-actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Report case" };

const STATUS_LABEL = { open: "Open", reviewing: "In review", closed: "Closed" } as const;
const EVENT_LABEL = { filed: "Reported", review_started: "Taken for review", closed: "Closed", reopened: "Opened again" } as const;
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function CasePage({ params }: { params: Promise<{ caseNo: string }> }) {
  const staff = await requireStaff();
  const { caseNo } = await params;
  const { env } = await getCloudflareContext({ async: true });
  // A case this person may not handle (it is about them, or they reported it) is a 404, like one that does not exist.
  const found = await getCase(getDb(env.DB), { userId: staff.userId, isAdmin: staff.role === "admin" }, caseNo);
  if (!found) notFound();

  return (
    <>
      <PageHeader
        title={found.caseId}
        actions={
          <Link href="/hq/cases" className="btn btn-ghost">
            <Icon name="arrow-left" size={18} />
            All cases
          </Link>
        }
      >
        {found.categoryLabel}. Reported {when(found.createdAt)}.
      </PageHeader>

      <Card id="case-post" icon="flag" title="The post as it was reported" aside={<Pill tone={found.status === "open" ? "attention" : "quiet"}>{STATUS_LABEL[found.status]}</Pill>}>
        <div className="case-post">
          <p>
            <strong>{found.post.authorName ?? found.post.authorUsername}</strong> <span className="muted">@{found.post.authorUsername}</span>
          </p>
          {found.post.body ? <p className="case-post-body">{found.post.body}</p> : null}
          <p className="hq-meta">
            {found.post.isReply ? "A reply" : "A post"} from {when(found.post.createdAt)}
            {found.post.photos > 0 ? ` · ${found.post.photos} ${found.post.photos === 1 ? "picture" : "pictures"}` : ""}
            {found.post.hasGif ? " · a GIF" : ""}
            {found.post.hasLink ? " · a link card" : ""}
            {found.post.stillUp ? " · still up" : " · no longer up"}
          </p>
        </div>
      </Card>

      <Card id="case-report" icon="user" title="The report">
        <dl className="case-facts">
          <div>
            <dt>Reason</dt>
            <dd>{found.categoryLabel}</dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>{found.reporter ? `${found.reporter.name} (@${found.reporter.username})` : "Someone who has left"}</dd>
          </div>
          <div>
            <dt>Their words</dt>
            <dd>{found.note || "Nothing added."}</dd>
          </div>
          <div>
            <dt>Other cases on this post</dt>
            <dd>
              {found.others.length === 0 ? (
                "None."
              ) : (
                <ul className="case-others">
                  {found.others.map((o) => (
                    <li key={o.caseNo}>
                      <Link href={`/hq/cases/${o.caseNo}`}>{o.caseId}</Link> <span className="muted">{o.categoryLabel}, {STATUS_LABEL[o.status].toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          {found.status === "closed" ? (
            <>
              <div>
                <dt>How it ended</dt>
                <dd>
                  {outcomeLabel(found.outcome)}
                  {found.handledByName ? ` (${found.handledByName})` : ""}
                </dd>
              </div>
              <div>
                <dt>Staff note</dt>
                <dd>{found.resolutionNote || "None."}</dd>
              </div>
            </>
          ) : found.handledByName ? (
            <div>
              <dt>Taken by</dt>
              <dd>{found.handledByName}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card id="case-actions" icon="check-circle" title="What to do" description="The person who wrote the post is never told about the report. If you take the post down they are told it was removed, and the person who reported is told when a case closes.">
        <CaseActions caseNo={found.caseNo} status={found.status} canRemove={found.post.canRemove} />
      </Card>

      <Card id="case-history" icon="calendar" title="History">
        <ol className="case-history">
          {found.events.map((e, i) => (
            <li key={i}>
              <strong>{EVENT_LABEL[e.type]}</strong>
              {e.type === "closed" ? `: ${outcomeLabel(e.detail)}` : ""}
              <span className="muted">
                {" "}
                · {e.actorName ?? "someone who has left"} · {when(e.at)}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
