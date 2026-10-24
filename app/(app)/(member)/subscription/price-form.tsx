"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearPriceAction, setPriceAction } from "./actions";

/** The monthly price a member charges, in dollars. */
export function PriceForm({ initialCents }: { initialCents: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialCents === null ? "" : (initialCents / 100).toFixed(2));
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      noValidate
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        setNote(null);
        start(async () => {
          const result = await setPriceAction(value);
          if (result.ok) {
            setNote({ kind: "ok", text: "Saved. Your profile now has a Subscribe button." });
            router.refresh();
          } else {
            setNote({ kind: "error", text: result.message });
          }
        });
      }}
    >
      <div className="field">
        <label htmlFor="price">Price a month, in US dollars</label>
        <input
          id="price"
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="5.00"
          aria-invalid={note?.kind === "error" ? true : undefined}
          aria-describedby="price-note"
          onChange={(e) => setValue(e.target.value)}
        />
        <p id="price-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
          {note?.text ?? (initialCents === null ? "You do not offer a subscription yet." : "This is what new subscribers pay.")}
        </p>
      </div>
      <div className="confirm">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving" : "Save price"}
        </button>
        {initialCents !== null ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setNote(null);
                await clearPriceAction();
                setValue("");
                setNote({ kind: "ok", text: "Stopped. Nobody new can subscribe. People already subscribed stay subscribed until they stop it." });
                router.refresh();
              })
            }
          >
            Stop offering
          </button>
        ) : null}
      </div>
    </form>
  );
}
