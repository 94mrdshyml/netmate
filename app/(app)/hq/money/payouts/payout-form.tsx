"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatUsd } from "@/lib/money";
import { recordPayoutAction } from "../../actions";

/** Records that the owner paid a member. The amount starts as everything owed and can never be more than that. */
export function PayoutForm({ creatorId, name, owedCents }: { creatorId: string; name: string; owedCents: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState((owedCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      className="rev-payout"
      noValidate
      aria-label={`Record a payout to ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setDone(false);
        start(async () => {
          const result = await recordPayoutAction(creatorId, amount, note);
          if (result.ok) {
            setDone(true);
            setNote("");
            router.refresh();
          } else {
            setError(result.message);
          }
        });
      }}
    >
      <div className="field">
        <label htmlFor={`pay-${creatorId}`}>Amount paid (US dollars)</label>
        <input id={`pay-${creatorId}`} className="input" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} />
      </div>
      <div className="field">
        <label htmlFor={`note-${creatorId}`}>Note (optional)</label>
        <input id={`note-${creatorId}`} className="input" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bank transfer, 24 Oct" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Record payout"}
      </button>
      <p className={error ? "error" : "hint"} role={error ? "alert" : done ? "status" : undefined}>
        {error ?? (done ? "Recorded." : `Owed now: ${formatUsd(owedCents)}.`)}
      </p>
    </form>
  );
}
