"use client";

import { useState, useTransition } from "react";
import { formatUsd } from "@/lib/money";
import { subscribeAction } from "../subscriptions/actions";

/**
 * The Subscribe button with the words that go with it: the price, that tax is added on top, where you pay, what Polar is
 * given and that the person can see your name. On a profile and on a locked post (CLAUDE.md rule 2 names this one place a
 * member's browser goes to a third party).
 */
export function SubscribeOffer({ creatorId, name, offerCents, testMode }: { creatorId: string; name: string; offerCents: number; testMode: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
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
    </>
  );
}
