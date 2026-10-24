"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REPORT_NOTE_MAX, REPORT_OUTCOMES } from "@/lib/report-categories";
import { Icon } from "../../../(member)/_components/icon";
import { closeCaseAction, reopenCaseAction, startReviewAction, type CaseActionResult } from "../../actions";

/** The buttons for one case: take it, close it with how it ended, or open it again. Each one sends the state wanted. */
export function CaseActions({ caseNo, status }: { caseNo: number; status: "open" | "reviewing" | "closed" }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState("handled");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (go: () => Promise<CaseActionResult>) => {
    setError(null);
    start(async () => {
      const result = await go();
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  if (status === "closed") {
    return (
      <div className="case-actions">
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(() => reopenCaseAction(caseNo))}>
          <Icon name="refresh-cw" size={18} />
          Open this case again
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="case-actions">
      {status === "open" ? (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => startReviewAction(caseNo))}>
          <Icon name="eye" size={18} />
          Take this case
        </button>
      ) : null}

      <form
        className="case-close"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          run(() => closeCaseAction(caseNo, outcome, note));
        }}
      >
        <fieldset className="case-outcomes">
          <legend>Close this case: how did it end?</legend>
          {REPORT_OUTCOMES.map((o) => (
            <label key={o.id} className="case-outcome">
              <input type="radio" name="outcome" value={o.id} checked={outcome === o.id} onChange={() => setOutcome(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="case-note">A note for the other staff (optional)</label>
          <textarea id="case-note" className="textarea" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className={status === "open" ? "btn btn-ghost" : "btn btn-primary"} disabled={pending}>
          <Icon name="check-circle" size={18} />
          {pending ? "Saving" : "Close case"}
        </button>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
