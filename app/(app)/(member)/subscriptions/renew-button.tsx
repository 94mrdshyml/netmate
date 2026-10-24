"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAutoRenewAction } from "./actions";

/** Stop renewing (asks first) or start renewing again. Sends the state wanted, so pressing twice changes nothing. */
export function RenewButton({ subscriptionId, name, stopped }: { subscriptionId: string; name: string; stopped: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (renew: boolean) =>
    start(async () => {
      setError(null);
      const result = await setAutoRenewAction(subscriptionId, renew);
      if (result.ok) {
        setAsking(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });

  return (
    <div className="stack">
      {stopped ? (
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => send(true)}>
          {pending ? "Saving" : `Keep subscribing to ${name}`}
        </button>
      ) : asking ? (
        <div className="confirm" role="group" aria-label={`Stop subscribing to ${name}?`}>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => send(false)}>
            {pending ? "Stopping" : "Yes, stop renewing"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => setAsking(true)}>
          {`Stop subscribing to ${name}`}
        </button>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
