"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatUsd } from "@/lib/money";
import { subscribeAction } from "../subscription/actions";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      <p className="hint">
        {testMode ? "Test mode: no real money moves. " : ""}Sales tax or VAT is added on top where it applies, and Polar shows you the total before you pay. Subscribe to see the posts {name} shares with subscribers only. You pay on Polar&apos;s secure page, which opens with your name and email from your account filled in (you can change them there), and you can stop any time. They can see your name as a subscriber.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await subscribeAction(creatorId);
            if (result.ok) window.location.assign(result.url);
            else setError(result.message);
          })
        }
      >
        {pending ? "Opening Polar" : `Subscribe for ${formatUsd(offerCents)} a month`}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
