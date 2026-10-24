import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { formatUsd } from "@/lib/money";
import { memberEarnings } from "@/server/revenue";
import { mySubscriptionSettings } from "@/server/subscriptions";
import Link from "next/link";
import { EmptyState } from "../../_components/empty-state";
import { MonthBars } from "../../_components/money-charts";
import { SubscriptionsHeader } from "../subscriptions-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "My subscribers" };

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function EarningsPage() {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const mine = await mySubscriptionSettings(db, member.userId);

  if (!mine.enabled) {
    return (
      <main className="column">
        <SubscriptionsHeader current="/subscriptions/earnings" />
        <EmptyState icon="credit-card" title="Subscriptions are not turned on here.">
          The person who runs this space has not switched them on.
        </EmptyState>
      </main>
    );
  }

  const earnings = await memberEarnings(db, member.userId);
  return (
    <main className="column">
      <SubscriptionsHeader current="/subscriptions/earnings" />
      {mine.testMode ? <p className="banner" role="status">Test mode: no real money moves. Payments here are practice ones.</p> : null}
      <section aria-labelledby="earn-heading" className="sub-section">
        <h2 id="earn-heading">Your earnings</h2>
        <dl className="sub-figures">
          <div>
            <dt>This month</dt>
            <dd>{formatUsd(earnings.thisMonth)}</dd>
          </div>
          <div>
            <dt>Earned in total</dt>
            <dd>{formatUsd(earnings.earned)}</dd>
          </div>
          <div>
            <dt>Paid to you</dt>
            <dd>{formatUsd(earnings.paid)}</dd>
          </div>
          <div>
            <dt>Still to be paid</dt>
            <dd>{formatUsd(earnings.stillToPay)}</dd>
          </div>
        </dl>
        <MonthBars months={earnings.months} mode="earned" label="What you earned each month" />
        <p className="hint">
          Your share is worked out on the price before tax, and a refund takes its share back. The person who runs this space pays you out and records each payment below.
        </p>
        {earnings.payouts.length > 0 ? (
          <ul className="case-list" aria-label="Paid to you">
            {earnings.payouts.map((p) => (
              <li key={p.id} className="case-row">
                <p className="case-row-top">
                  <strong>{formatUsd(p.amountCents)}</strong>
                  <span className="muted">{DAY.format(p.at)}</span>
                </p>
                {p.note ? <p className="case-row-excerpt">{p.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="who-heading" className="sub-section">
        <h2 id="who-heading">Your subscribers</h2>
        <p className="hint">
          {mine.subscribers === 0 ? "Nobody is subscribed to you yet." : `${mine.subscribers} ${mine.subscribers === 1 ? "person is" : "people are"} subscribed to you.`} Only you and the person who runs this space can see this list.
        </p>
        {earnings.subscribers.length > 0 ? (
          <ul className="case-list" aria-label="Your subscribers">
            {earnings.subscribers.map((p) => (
              <li key={p.userId + p.since} className="case-row">
                <p className="case-row-top">
                  <Link href={`/${p.username}`}>
                    <strong>{p.name}</strong> <span className="muted">@{p.username}</span>
                  </Link>
                  <span className={p.live ? "case-state case-state-live" : "case-state"}>{p.live ? "Subscribed" : "Ended"}</span>
                </p>
                <p className="muted case-row-when">
                  Since {DAY.format(p.since)} · {formatUsd(p.priceCents)} a month ·{" "}
                  {p.live ? (p.stopsAtPeriodEnd ? `stops${p.periodEnd ? ` on ${DAY.format(p.periodEnd)}` : " at the end of the month"}` : p.periodEnd ? `renews on ${DAY.format(p.periodEnd)}` : "renews every month") : "no longer renewing"}
                </p>
                <p className="case-row-excerpt">You have earned {formatUsd(p.earnedFromThem)} from them.</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
