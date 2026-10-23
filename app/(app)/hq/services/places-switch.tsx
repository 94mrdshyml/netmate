"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePlacesAction } from "../actions";

/** The on and off switch for place suggestions. It saves as soon as it is pressed. */
export function PlacesSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="hq-switch-row">
      <span id="places-label" className="hq-switch-text">
        Suggest places
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby="places-label"
        aria-describedby="places-note"
        disabled={pending}
        onClick={() => {
          const wanted = !on;
          setOn(wanted);
          setNote(null);
          start(async () => {
            const result = await savePlacesAction(wanted);
            if (result.ok) {
              setNote({ kind: "ok", text: wanted ? "Place suggestions are on." : "Place suggestions are off." });
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
      <p id="places-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
        {note?.text ?? ""}
      </p>
    </div>
  );
}
