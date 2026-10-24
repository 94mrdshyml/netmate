"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPaymentsEnabledAction } from "../actions";

/** The on and off switch for subscriptions. It saves as soon as it is pressed; turning it on needs the keys saved. */
export function EnabledSwitch({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="hq-switch-row">
      <span id="subs-label" className="hq-switch-text">
        Members can offer subscriptions
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby="subs-label"
        aria-describedby="subs-note"
        disabled={pending || (!ready && !on)}
        onClick={() => {
          const wanted = !on;
          setOn(wanted);
          setNote(null);
          start(async () => {
            const result = await setPaymentsEnabledAction(wanted);
            if (result.ok) {
              setNote({ kind: "ok", text: wanted ? "Subscriptions are on." : "Subscriptions are off." });
              router.refresh();
            } else {
              setOn(!wanted);
              setNote({ kind: "error", text: result.message });
            }
          });
        }}
      >
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </button>
      <p id="subs-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
        {note?.text ?? (ready || on ? "" : "Save the keys and test the connection first.")}
      </p>
    </div>
  );
}
