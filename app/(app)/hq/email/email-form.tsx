"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "../../(member)/_components/icon";
import { ConfirmButton } from "../confirm-button";
import { removeEmailAction, saveEmailAction, sendTestEmailAction } from "../actions";
import { Card } from "../hq-ui";

type Note = { kind: "ok" | "error"; text: string };

export function EmailForm({ setUp, initialFrom, testTo }: { setUp: boolean; initialFrom: string; testTo: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="hq-grid">
      <form
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
        <Card
          id="connection-heading"
          icon="key"
          title="Resend connection"
          description="Where the emails come from."
          footer={
            <>
              <p className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
                {note?.text ?? ""}
              </p>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "Saving" : "Save"}
              </button>
            </>
          }
        >
          <div className="stack">
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
          </div>
        </Card>
      </form>

      {setUp ? <Tools testTo={testTo} /> : null}
    </div>
  );
}

function Tools({ testTo }: { testTo: string }) {
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="hq-col">
      <Card
        id="test-heading"
        icon="send"
        title="Test"
        description={`Sends a test email to your own address, ${testTo}. Five an hour.`}
        footer={
          <>
            <p className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
              {note?.text ?? ""}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
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
              <Icon name="send" size={18} />
              {pending ? "Sending" : "Send test email"}
            </button>
          </>
        }
      >
        <p className="hint">Use it after you save, to be sure the key and sender work.</p>
      </Card>

      <Card id="remove-heading" icon="x" title="Remove" description="Forgets the key and sender. Email goes back to not set up.">
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
      </Card>
    </div>
  );
}
