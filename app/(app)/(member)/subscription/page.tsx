import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { formatUsd, PRICE_MAX_CENTS, PRICE_MIN_CENTS } from "@/lib/money";
import { mySubscriptionSettings } from "@/server/subscriptions";
import { EmptyState } from "../_components/empty-state";
import { PageHeader } from "../_components/page-header";
import { PriceForm } from "./price-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscription price" };

export default async function SubscriptionPage() {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { env } = await getCloudflareContext({ async: true });
  const mine = await mySubscriptionSettings(getDb(env.DB), member.userId);

  if (!mine.enabled) {
    return (
      <main className="column">
        <PageHeader title="Subscription price" back={{ href: "/settings", label: "Back to Settings" }} centered />
        <EmptyState icon="credit-card" title="Subscriptions are not turned on here.">
          The person who runs this space has not switched them on.
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="column">
      <PageHeader title="Subscription price" back={{ href: "/settings", label: "Back to Settings" }} centered />
      {mine.testMode ? <p className="banner" role="status">Test mode: no real money moves. Payments here are practice ones.</p> : null}
      <p className="hint">
        Charge a monthly price and others can subscribe to see the posts you share with subscribers only. Choose a price from {formatUsd(PRICE_MIN_CENTS)} to {formatUsd(PRICE_MAX_CENTS)}. The price includes any sales tax or VAT, wherever the subscriber lives, so they always pay exactly this.
        You earn {mine.creatorPercent}% of each payment after the tax is taken out, and the tax depends on where the subscriber lives. Payments are taken by Polar, who also handle sales tax,
        and the person who runs this space pays your share out to you.
      </p>
      <PriceForm initialCents={mine.priceCents} />
      <p className="hint">
        {mine.subscribers === 0 ? "Nobody is subscribed to you yet." : `${mine.subscribers} ${mine.subscribers === 1 ? "person is" : "people are"} subscribed to you.`} You see the number, not who.
        If you change your price, people already subscribed keep the price they agreed to.
      </p>
    </main>
  );
}
