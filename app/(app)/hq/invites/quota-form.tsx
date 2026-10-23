"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveQuotaAction } from "../actions";

export function QuotaForm({ initial }: { initial: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initial));
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
          const result = await saveQuotaAction(value);
          if (result.ok) {
            setNote({ kind: "ok", text: "Saved." });
            router.refresh();
          } else {
            setNote({ kind: "error", text: result.message });
          }
        });
      }}
    >
      <div className="field">
        <label htmlFor="quota">Sign-ups approved per member link</label>
        <input
          id="quota"
          className="input"
          inputMode="numeric"
          value={value}
          aria-invalid={note?.kind === "error" ? true : undefined}
          aria-describedby="quota-note"
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </button>
      <p id="quota-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
        {note?.text ?? ""}
      </p>
    </form>
  );
}
