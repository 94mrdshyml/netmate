import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { formatUsd } from "@/lib/money";
import { monthLabel } from "@/lib/revenue";
import { ownerRevenue } from "@/server/revenue";
import { EmptyState } from "../../(member)/_components/empty-state";
import { MoneyBar, MonthBars } from "../../(member)/_components/money-charts";
import { ConfirmButton } from "../confirm-button";
import { Card, Initial, PageHeader, Pill, Stat } from "../hq-ui";
import { voidPayoutAction } from "../actions";
import { PayoutForm } from "./payout-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Revenue" };

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function RevenuePage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const r = await ownerRevenue(getDb(env.DB));
  const t = r.totals;
  const rows: { label: string; note?: string; cents: number; sign: "" | "-" | "="; strong?: boolean }[] = [
    { label: "Collected from subscribers", note: "What they paid, tax included", cents: t.collected, sign: "" },
    { label: "Refunded", note: "Money that went back to subscribers", cents: t.refunded, sign: "-" },
    { label: "Tax", note: "Polar collects it and pays it on", cents: t.tax, sign: "-" },
    { label: "Polar's fee", note: "An estimate from the rate you set on Payments", cents: t.polarFee, sign: "-" },
    { label: "Reaches you", note: "What Polar holds for you", cents: t.reachesYou, sign: "=", strong: true },
    { label: "Members earned", note: `${formatUsd(t.memberPaid)} paid out, ${formatUsd(t.stillToPay)} still to pay`, cents: t.memberEarned, sign: "-" },
    { label: "Yours to keep", note: "What is left after everyone", cents: t.yoursToKeep, sign: "=", strong: true },
  ];

  return (
    <>
      <PageHeader title="Revenue">What subscribers paid, what the tax and Polar take, what members earn, and what is left for you. Only payments Polar has told us about are counted.</PageHeader>

      {r.mode === "sandbox" ? (
        <p className="banner hq-alert" role="status">
          Test mode: these are practice payments from Polar&apos;s sandbox. No real money moved. Live payments are counted separately once you switch to live mode.
        </p>
      ) : null}

      <div className="hq-stats">
        <Stat icon="credit-card" label="Collected" value={formatUsd(t.collected)} note={`${r.payments} ${r.payments === 1 ? "payment" : "payments"}, tax included`} />
        <Stat icon="inbox" label="Reaches you" value={formatUsd(t.reachesYou)} note="After refunds, tax and Polar's fee" />
        <Stat icon="users" label="Members are owed" value={formatUsd(t.stillToPay)} note={`${formatUsd(t.memberPaid)} already paid out`} />
        <Stat icon="check-circle" label="Yours to keep" value={formatUsd(t.yoursToKeep)} note="After everything above" />
      </div>

      <Card id="split-heading" icon="percent" title="Where the money goes" description="Everything collected, split into the parts that are not yours and the part that is.">
        <MoneyBar ledger={t} />
        <div className="hq-table-wrap">
          <table className="hq-table">
            <caption className="sr-only">From what was collected to what you keep</caption>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className={row.strong ? "rev-strong" : undefined}>
                  <th scope="row">
                    {row.label}
                    {row.note ? <span className="hq-meta rev-note">{row.note}</span> : null}
                  </th>
                  <td className="rev-sign" aria-hidden="true">
                    {row.sign}
                  </td>
                  <td className="rev-num">{formatUsd(row.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Polar does not report its own fee on each payment, so it is worked out from the percent and fixed amount you set on Payments, once, when a payment is first counted. Your Polar statement is the final word. If the price is small, Polar&apos;s fixed fee can take most of
          it and &quot;yours&quot; can be below zero.
        </p>
      </Card>

      <Card id="months-heading" icon="bar-chart" title="Month by month" description="The last twelve months, by the day each payment was made. Each bar is what was collected, split the same way.">
        <MonthBars months={r.months} mode="stacked" label="Collected each month" />
        <div className="hq-table-wrap">
          <table className="hq-table rev-months">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Payments</th>
                <th scope="col">Collected</th>
                <th scope="col">Tax</th>
                <th scope="col">Polar&apos;s fee</th>
                <th scope="col">Members</th>
                <th scope="col">Yours</th>
              </tr>
            </thead>
            <tbody>
              {[...r.months].reverse().map((m) => (
                <tr key={m.key}>
                  <th scope="row">{monthLabel(m.key)}</th>
                  <td>{m.payments}</td>
                  <td>{formatUsd(m.ledger.collected)}</td>
                  <td>{formatUsd(m.ledger.tax)}</td>
                  <td>{formatUsd(m.ledger.polarFee)}</td>
                  <td>{formatUsd(m.ledger.memberEarned)}</td>
                  <td>{formatUsd(m.ledger.yoursToKeep)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
