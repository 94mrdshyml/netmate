"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removePaymentKeysAction, savePaymentConnectionAction, testPolarAction } from "../actions";
import { ConfirmButton } from "../confirm-button";

type Note = { kind: "ok" | "error"; text: string };

/** The Polar keys. A saved key is never shown again; a blank box keeps it. */
export function ConnectionForm({ mode, hasToken, hasWebhookSecret }: { mode: "sandbox" | "production"; hasToken: boolean; hasWebhookSecret: boolean }) {
  const router = useRouter();
  const [chosen, setChosen] = useState(mode);
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();
  const saved = hasToken && hasWebhookSecret;

  return (
    <div className="stack">
      <form
        noValidate
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setNote(null);
          start(async () => {
            const result = await savePaymentConnectionAction({ mode: chosen, accessToken: token, webhookSecret: secret });
            if (result.ok) {
              // Once saved the keys leave the page: they are never shown again.
              setToken("");
              setSecret("");
              setNote({ kind: "ok", text: "Saved." });
              router.refresh();
            } else {
              setNote({ kind: "error", text: result.message });
            }
          });
        }}
      >
        <fieldset className="choices choices-2">
          <legend>Which Polar</legend>
          <label className="choice">
            <input type="radio" name="polar-mode" value="sandbox" checked={chosen === "sandbox"} onChange={() => setChosen("sandbox")} />
            <span>Test mode</span>
          </label>
          <label className="choice">
            <input type="radio" name="polar-mode" value="production" checked={chosen === "production"} onChange={() => setChosen("production")} />
            <span>Live mode</span>
          </label>
        </fieldset>
        <p className="hint">Test mode uses Polar&apos;s sandbox, where no real money moves. Try everything there first. The token and secret from one mode do not work in the other.</p>

        <div className="field">
          <label htmlFor="polarToken">Polar access token</label>
          <input
            id="polarToken"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            placeholder={hasToken ? "Token saved" : "Paste your token"}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="polarSecret">Polar webhook secret</label>
          <input
            id="polarSecret"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            placeholder={hasWebhookSecret ? "Secret saved" : "Paste your secret"}
            onChange={(event) => setSecret(event.target.value)}
          />
          <p id="polar-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
            {note?.text ?? (saved ? "Keys are saved and cannot be shown again. Paste a new one to replace it." : "Both are stored locked on this server and are never shown again.")}
          </p>
        </div>
        <div className="hq-inline">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </button>
          {saved ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() => {
                setNote(null);
                start(async () => {
                  const result = await testPolarAction();
                  setNote({ kind: result.ok ? "ok" : "error", text: result.message });
                });
              }}
            >
              Test the connection
            </button>
          ) : null}
        </div>
      </form>

      {hasToken || hasWebhookSecret ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNote(null);
            start(async () => {
              const result = await removePaymentKeysAction();
              if (result.ok) {
                setNote({ kind: "ok", text: "Keys removed." });
                router.refresh();
              } else {
                setNote({ kind: "error", text: "Could not remove the keys. Try again." });
              }
            });
          }}
        >
          <ConfirmButton label="Remove the keys" confirmLabel="Yes, remove them" className="btn btn-ghost" icon="trash-2" />
        </form>
      ) : null}
    </div>
  );
}
