import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { listPending } from "@/server/admin";
import { approveAction, rejectAction } from "../actions";
import { ConfirmButton } from "../confirm-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Approvals" };

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default async function ApprovalsPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const people = await listPending(getDb(env.DB));

  return (
    <>
      <h1>Approvals</h1>
      <p className="hint">These people joined through a member link that had used up its automatic approvals.</p>

      {people.length === 0 ? (
        <p className="empty">Nobody is waiting.</p>
      ) : (
        <ul className="hq-list" aria-label="Waiting for approval">
          {people.map((p) => (
            <li key={p.userId} className="hq-item">
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
                    Approve
                  </button>
                </form>
                <form action={rejectAction}>
                  <input type="hidden" name="userId" value={p.userId} />
                  <ConfirmButton label="Reject" confirmLabel="Yes, reject" className="btn btn-ghost" />
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
