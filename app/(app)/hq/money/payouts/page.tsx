import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { formatUsd } from "@/lib/money";
import { ownerRevenue } from "@/server/revenue";
import { EmptyState } from "../../../(member)/_components/empty-state";
import { voidPayoutAction } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { Card, Initial, Pill, Stat } from "../../hq-ui";
import { MoneyHeader } from "../money-header";
import { PayoutForm } from "./payout-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Members and payouts" };

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function PayoutsPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const r = await ownerRevenue(getDb(env.DB));
  const t = r.totals;

  return (
    <>
      <MoneyHeader current="/hq/money/payouts">Who has earned what, who is still owed, and the payouts you have recorded. You pay members yourself, then record it here.</MoneyHeader>

      <div className="hq-stats">
        <Stat icon="users" label="Members are owed" value={formatUsd(t.stillToPay)} note="Earned and not yet paid" />
        <Stat icon="check-circle" label="Paid out so far" value={formatUsd(t.memberPaid)} note="Payouts you have recorded" />
        <Stat icon="inbox" label="Members earned" value={formatUsd(t.memberEarned)} note="All time, after refunds" />
        <Stat icon="check-circle" label="Yours to keep" value={formatUsd(t.yoursToKeep)} note="Not changed by a payout: it was already theirs" />
      </div>

      <Card id="members-heading" icon="users" title="Members" description="What each member has earned, what you have paid them, and what is still owed. Pay them yourself, then record it here.">
        {r.members.length === 0 ? (
          <EmptyState icon="users" title="Nobody has earned anything yet.">
            When someone subscribes and Polar tells us about the payment, the member shows up here.
          </EmptyState>
        ) : (
          <ul className="hq-list" aria-label="Members and what they are owed">
            {r.members.map((m) => (
              <li key={m.userId} className="hq-item hq-member">
                <Initial name={m.name} />
                <div className="hq-item-text">
                  <strong>{m.name}</strong> <span className="muted">@{m.username}</span>{" "}
                  {m.stillToPay > 0 ? <Pill tone="attention">{formatUsd(m.stillToPay)} owed</Pill> : <Pill>Paid up</Pill>}
                  <div className="hq-meta">
                    {m.subscribers} {m.subscribers === 1 ? "subscriber" : "subscribers"} · {m.payments} {m.payments === 1 ? "payment" : "payments"}
                  </div>
                </div>
                <dl className="hq-counts" aria-label={`Money for ${m.name}`}>
                  <div>
                    <dt>Earned</dt>
                    <dd>{formatUsd(m.earned)}</dd>
                  </div>
                  <div>
                    <dt>Paid out</dt>
                    <dd>{formatUsd(m.paid)}</dd>
                  </div>
                  <div>
                    <dt>Still to pay</dt>
                    <dd>{formatUsd(m.stillToPay)}</dd>
                  </div>
                </dl>
                {m.stillToPay > 0 ? <PayoutForm creatorId={m.userId} name={m.name} owedCents={m.stillToPay} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="payouts-heading" icon="check-circle" title="Payouts you have recorded" description="Newest first. A mistake is voided, not deleted, so the record stays whole.">
        {r.payouts.length === 0 ? (
          <p className="hint">No payouts recorded yet.</p>
        ) : (
          <ul className="hq-list" aria-label="Recorded payouts">
            {r.payouts.map((p) => (
              <li key={p.id} className="hq-item">
                <div className="hq-item-text">
                  <strong>{formatUsd(p.amountCents)}</strong> to {p.name} <span className="muted">@{p.username}</span> {p.voided ? <Pill>Voided</Pill> : null}
                  <div className="hq-meta">
                    {DAY.format(p.at)}
                    {p.note ? ` · ${p.note}` : ""}
                  </div>
                </div>
                {p.voided ? null : (
                  <form action={voidPayoutAction} className="hq-item-actions">
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmButton label="Void" confirmLabel="Yes, void it" className="btn btn-ghost" icon="x" />
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
