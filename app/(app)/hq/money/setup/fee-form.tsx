"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePolarFeeAction } from "../../actions";

/** Polar's fee as it stands in the owner's Polar plan, used only for the owner's estimate on the Money overview. */
export function FeeForm({ feeBp, feeFixedCents }: { feeBp: number; feeFixedCents: number }) {
  const router = useRouter();
  const [percent, setPercent] = useState((feeBp / 100).toFixed(2));
  const [fixed, setFixed] = useState((feeFixedCents / 100).toFixed(2));
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="hq-inline"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setNote(null);
        start(async () => {
          const result = await savePolarFeeAction(percent, fixed);
          if (result.ok) {
            setNote({ kind: "ok", text: "Saved." });
            router.refresh();
          } else {
            setNote({ kind: "error", text: result.message });
          }
        });
      }}
    >
      <div className="field hq-inline-field">
        <label htmlFor="feePercent">Percent of each payment</label>
        <input id="feePercent" className="input" inputMode="decimal" autoComplete="off" value={percent} onChange={(e) => setPercent(e.target.value)} aria-describedby="fee-note" />
      </div>
      <div className="field hq-inline-field">
        <label htmlFor="feeFixed">Plus a fixed amount (US dollars)</label>
        <input id="feeFixed" className="input" inputMode="decimal" autoComplete="off" value={fixed} onChange={(e) => setFixed(e.target.value)} aria-describedby="fee-note" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Save fee"}
      </button>
      <p id="fee-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
        {note?.text ?? ""}
      </p>
    </form>
  );
}
