"use client";

import Link from "next/link";
import { SubscribeOffer } from "./subscribe-offer";

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** On a profile: Subscribe (with the price and where you will pay), or a line saying you are subscribed. */
export function SubscribeBox({
  creatorId,
  name,
  offerCents,
  mine,
  testMode,
}: {
  creatorId: string;
  name: string;
  offerCents: number | null;
  mine: { cancelAtPeriodEnd: boolean; renewsOrEndsAt: number | null } | null;
  testMode: boolean;
}) {
  if (mine) {
    return (
      <div className="subscribe-box">
        <p>
          <strong>You are subscribed.</strong>{" "}
          {mine.cancelAtPeriodEnd
            ? mine.renewsOrEndsAt
              ? `It ends on ${DAY.format(mine.renewsOrEndsAt)}.`
              : "It ends at the end of the month you paid for."
            : mine.renewsOrEndsAt
              ? `It renews on ${DAY.format(mine.renewsOrEndsAt)}.`
              : "It renews every month."}{" "}
          <Link href="/subscriptions">Manage</Link>
        </p>
      </div>
    );
  }
  if (offerCents === null) return null;

  return (
    <div className="subscribe-box">
      <SubscribeOffer creatorId={creatorId} name={name} offerCents={offerCents} testMode={testMode} />
    </div>
  );
}
