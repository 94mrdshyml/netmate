import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { listPending } from "@/server/admin";
import { EmptyState } from "../../(member)/_components/empty-state";
import { Icon } from "../../(member)/_components/icon";
import { approveAction, rejectAction } from "../actions";
import { ConfirmButton } from "../confirm-button";
import { Card, Initial, PageHeader, Pill } from "../hq-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Approvals" };

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function ApprovalsPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const people = await listPending(getDb(env.DB));

  return (
    <>
      <PageHeader title="Approvals">These people joined through a member link that had used up its automatic approvals.</PageHeader>

      <Card
        id="waiting-heading"
        icon="user-check"
        title="Waiting for approval"
        aside={<Pill tone={people.length > 0 ? "attention" : "quiet"}>{people.length === 1 ? "1 person" : `${people.length} people`}</Pill>}
      >
        {people.length === 0 ? (
          <EmptyState icon="check-circle" title="Nobody is waiting.">
            New requests show up here as soon as someone joins past the automatic approvals.
          </EmptyState>
        ) : (
          <ul className="hq-list" aria-label="Waiting for approval">
            {people.map((p) => (
              <li key={p.userId} className="hq-item">
                <Initial name={p.name} />
                <div className="hq-item-text">
                  <strong>{p.name}</strong> <span className="muted">@{p.username}</span>
                  <div className="hq-meta">
                    {p.email} · joined {when(p.createdAt)}
                    {p.invitedByName ? ` · through ${p.invitedByName}'s link` : ""}
                  </div>
                </div>
                <div className="hq-item-actions">
                  <form action={approveAction}>
                    <input type="hidden" name="userId" value={p.userId} />
                    <button type="submit" className="btn btn-primary" aria-label={`Approve ${p.name}`}>
                      <Icon name="check" size={18} />
                      Approve
                    </button>
                  </form>
                  <form action={rejectAction}>
                    <input type="hidden" name="userId" value={p.userId} />
                    <ConfirmButton label="Reject" confirmLabel="Yes, reject" className="btn btn-ghost" icon="x" />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
