import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { formatUsd, polarFeeCents, splitPreview } from "@/lib/money";
import { paymentPanel } from "@/server/payments";
import { siteOrigin } from "@/server/origin";
import { CopyButton } from "../copy-button";
import { Card, PageHeader, Pill } from "../hq-ui";
import { ConnectionForm } from "./connection-form";
import { EnabledSwitch } from "./enabled-switch";
import { FeeForm } from "./fee-form";
import { SplitForm } from "./split-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payments" };

const EXAMPLE_CENTS = 1000;

export default async function PaymentsPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const panel = await paymentPanel(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);
  const webhookUrl = `${siteOrigin(env, await headers())}/api/webhooks/polar`;
  const connected = panel.hasToken && panel.hasWebhookSecret;
  const example = splitPreview(EXAMPLE_CENTS, panel.creatorPercent);
  const fee = polarFeeCents(EXAMPLE_CENTS, panel.feeBp, panel.feeFixedCents);

  return (
    <>
      <PageHeader title="Payments">
        Members can charge a monthly price for posts that only their subscribers see. Payments are taken by Polar and land in your Polar account. You decide how much of each payment the member earns.
      </PageHeader>

      <Card
        id="connection-heading"
        icon="credit-card"
        title="Connect Polar"
        description="Polar takes the payment, handles sales tax and sends you the money."
        aside={connected ? <Pill icon="check-circle">Keys saved</Pill> : <Pill>Not connected</Pill>}
      >
        {!panel.readable ? (
          <p className="banner" role="status">
            The saved keys cannot be read any more, because the key this server uses to lock them has changed. Paste them again below.
          </p>
        ) : null}
        <ConnectionForm mode={panel.mode} hasToken={panel.hasToken} hasWebhookSecret={panel.hasWebhookSecret} />
        <div className="field">
          <label htmlFor="webhook-url">Webhook address to give Polar</label>
          <div className="hq-inline">
            <input id="webhook-url" className="input" readOnly value={webhookUrl} />
            <CopyButton url={webhookUrl} label="Copy address" />
          </div>
          <p className="hint">
            In Polar, open Settings, then Webhooks, add this address, tick the subscription, order and refund events, and paste the secret Polar shows you into the box above. Make the access token in Polar under Settings, then Developers, with the permissions for products, checkouts, subscriptions, orders and customers.
          </p>
        </div>
      </Card>

      <Card
        id="switch-heading"
        icon="credit-card"
        title="Subscriptions"
        description="Off until you turn it on. Members then see a Subscription price row in Settings, and a Subscribe button on profiles that have a price."
        aside={panel.enabled ? <Pill icon="check-circle">On</Pill> : <Pill>Off</Pill>}
      >
        <EnabledSwitch enabled={panel.enabled} ready={connected && panel.readable} />
        <p className="hint">
          {panel.mode === "sandbox"
            ? "You are in test mode: payments are practice ones and no real money moves. Switching between test and live turns subscriptions off, and the people who subscribed in test mode are not subscribers in live mode."
            : "You are in live mode: real money moves. Switching between test and live turns subscriptions off."}
        </p>
      </Card>

      <Card
        id="split-heading"
        icon="percent"
        title="How payments are shared"
        description="The share of every payment, before tax, that goes to the member being paid for."
      >
        <SplitForm initial={panel.creatorPercent} />
        <p className="hint">
          Prices are before tax: Polar adds the tax of the subscriber&apos;s country on top, collects it and pays it on. Example: a member charges {formatUsd(EXAMPLE_CENTS)} a month. They earn {formatUsd(example.creator)} and your side is {formatUsd(example.owner)}. Polar keeps a fee out of your side (roughly {formatUsd(fee)} on {formatUsd(EXAMPLE_CENTS)} at Polar&apos;s published rates, which can change), so you keep about {formatUsd(Math.max(0, example.owner - fee))}. Tax is never part of the sharing, so it takes nothing from either side. If Polar refunds a payment, the member&apos;s share of it is taken back in the same proportion. A change here only applies to payments made after it.
        </p>
      </Card>

      <Card
        id="fee-heading"
        icon="percent"
        title="Polar's fee"
        description="Polar keeps a fee from every payment. Enter your rate so the Revenue page can show what is left for you."
      >
        <FeeForm feeBp={panel.feeBp} feeFixedCents={panel.feeFixedCents} />
        <p className="hint">
          Take the figures from your Polar plan (a new account started at 4% plus 40 cents, with 0.5% more for subscriptions, so 4.5% and 0.40 is a good start).
          Polar does not tell us its fee on each payment, so this is an estimate: it is worked out once, on the amount before tax, when a payment is first counted, and a later change applies only to new payments.
          It is never used to pay anyone. Your Polar statement is the final word.
        </p>
      </Card>
    </>
  );
}
