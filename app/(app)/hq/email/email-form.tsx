"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmButton } from "../confirm-button";
import { removeEmailAction, saveEmailAction, sendTestEmailAction } from "../actions";

type Note = { kind: "ok" | "error"; text: string };

export function EmailForm({ setUp, initialFrom, testTo }: { setUp: boolean; initialFrom: string; testTo: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <form
        className="stack hq-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          setNote(null);
          start(async () => {
            const result = await saveEmailAction({ from, apiKey });
            if (result.ok) {
              // Once saved the key leaves the page: it is never shown again.
              setApiKey("");
              setNote({ kind: "ok", text: "Saved." });
              router.refresh();
            } else {
              setErrors(result.fieldErrors);
              setNote({
                kind: "error",
                text: result.code === "failed" ? "Could not save. Try again." : result.code === "invalid" ? "Some answers need fixing." : "Resend did not accept the key.",
              });
            }
          });
        }}
      >
        {note ? (
          <p className="banner" role={note.kind === "error" ? "alert" : "status"}>
            {note.text}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="from">Sender address</label>
          <input
            id="from"
            className="input"
            type="email"
            autoComplete="off"
            value={from}
            aria-invalid={errors.from ? true : undefined}
            aria-describedby="from-note"
            onChange={(e) => setFrom(e.target.value)}
          />
          <p id="from-note" className={errors.from ? "error" : "hint"}>
            {errors.from ?? "For example hello@yourdomain.com. Emails come from this address."}
          </p>
        </div>

        <div className="field">
          <label htmlFor="apiKey">Resend API key</label>
          <input
            id="apiKey"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder={setUp ? "Key saved" : "re_..."}
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby="apiKey-note"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p id="apiKey-note" className={errors.apiKey ? "error" : "hint"}>
            {errors.apiKey ?? (setUp ? "A key is saved and cannot be shown again. Leave this empty to keep it, or paste a new one to replace it." : "Create a key in Resend. It is checked with Resend and stored encrypted.")}
          </p>
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </button>
        </div>
      </form>

      {setUp ? <Tools testTo={testTo} /> : null}
    </>
  );
}

function Tools({ testTo }: { testTo: string }) {
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="stack" aria-label="Test and remove">
      <h2>Test</h2>
      <p className="hint">Sends a test email to your own address, {testTo}. Five an hour.</p>
      <div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => {
            setNote(null);
            start(async () => {
              const result = await sendTestEmailAction();
              setNote(result.ok ? { kind: "ok", text: "Test email sent. Check your inbox." } : { kind: "error", text: result.message });
              router.refresh();
            });
          }}
        >
          {pending ? "Sending" : "Send test email"}
        </button>
      </div>
      {note ? (
        <p className={note.kind === "error" ? "error" : "banner"} role={note.kind === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      ) : null}

      <h2>Remove</h2>
      <p className="hint">Forgets the key and sender. Email goes back to not set up.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            await removeEmailAction();
            router.refresh();
          });
        }}
      >
        <ConfirmButton label="Remove email settings" confirmLabel="Yes, remove" className="btn btn-ghost" />
      </form>
    </section>
  );
}
