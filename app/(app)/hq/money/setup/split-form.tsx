"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePaymentSplitAction } from "../../actions";

/** The member's share of each payment, as a whole percent. */
export function SplitForm({ initial }: { initial: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initial));
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const percent = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;

  return (
    <form
      className="hq-inline"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setNote(null);
        start(async () => {
          const result = await savePaymentSplitAction(value);
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
        <label htmlFor="creatorPercent">Percent the member earns</label>
        <input
          id="creatorPercent"
          className="input"
          inputMode="numeric"
          value={value}
          aria-invalid={note?.kind === "error" ? true : undefined}
          aria-describedby="split-note"
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </button>
      <p id="split-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
        {note?.text ?? (percent !== null && percent <= 100 ? `Member ${percent}%, you ${100 - percent}%.` : "")}
      </p>
    </form>
  );
}
