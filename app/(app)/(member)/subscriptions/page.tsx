import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { formatUsd } from "@/lib/money";
import { readPaymentSettings } from "@/server/payments";
import { listMySubscriptions } from "@/server/subscriptions";
import { EmptyState } from "../_components/empty-state";
import { RenewButton } from "./renew-button";
import { SubscriptionsHeader } from "./subscriptions-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscriptions" };

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function SubscriptionsPage() {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const settings = await readPaymentSettings(db);
  const list = settings.enabled ? await listMySubscriptions(db, member.userId) : [];

  return (
    <main className="column">
      <SubscriptionsHeader current="/subscriptions" />
      {settings.mode === "sandbox" && settings.enabled ? <p className="banner" role="status">Test mode: no real money moves.</p> : null}
      {!settings.enabled ? (
        <EmptyState icon="credit-card" title="Subscriptions are not turned on here." />
      ) : list.length === 0 ? (
        <EmptyState icon="credit-card" title="You are not subscribed to anyone.">
          When someone offers a subscription, their profile has a Subscribe button.
        </EmptyState>
      ) : (
        <ul className="case-list" aria-label="Your subscriptions">
          {list.map((s) => {
            const name = `${s.creator.firstName} ${s.creator.lastName}`;
            return (
              <li key={s.id} className="case-row">
                <p className="case-row-top">
                  <Link href={`/${s.creator.username}`}>
                    <strong>{name}</strong> <span className="muted">@{s.creator.username}</span>
                  </Link>
                  <span className="muted">{formatUsd(s.priceCents)} a month</span>
                </p>
                <p className="muted case-row-when">
                  {s.cancelAtPeriodEnd
                    ? s.renewsOrEndsAt
                      ? `Ends on ${DAY.format(s.renewsOrEndsAt)}. You keep access until then.`
                      : "Ends at the end of the month you paid for."
                    : s.renewsOrEndsAt
                      ? `Renews on ${DAY.format(s.renewsOrEndsAt)}.`
                      : "Renews every month."}
                </p>
                <RenewButton subscriptionId={s.id} name={name} stopped={s.cancelAtPeriodEnd} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
