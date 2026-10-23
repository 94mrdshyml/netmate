"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { klipyUrl, KLIPY_KEY_PATTERN, parseKlipyPage } from "@/lib/gif";
import { removeKlipyKeyAction, saveKlipyKeyAction } from "../actions";
import { ConfirmButton } from "../confirm-button";

type Note = { kind: "ok" | "error"; text: string };

/** The Klipy key box. A new key is tried with Klipy from this browser first, then stored encrypted and never shown again. */
export function GifForm({ state }: { state: "off" | "on" | "unreadable" }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();

  async function save() {
    const typed = key.trim();
    if (typed === "") return setNote({ kind: "error", text: "Enter your Klipy key." });
    if (!KLIPY_KEY_PATTERN.test(typed)) {
      return setNote({ kind: "error", text: "That does not look like a Klipy key. It has only letters, numbers, dashes and underscores." });
    }
    // Klipy wants every request to come from a browser, so the key is tried from here, not from the server.
    try {
      const res = await fetch(klipyUrl(typed, "", 1), { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) return setNote({ kind: "error", text: "Klipy did not accept that key." });
      if (!parseKlipyPage(await res.json().catch(() => null))) return setNote({ kind: "error", text: "Klipy sent back something we could not read." });
    } catch {
      return setNote({ kind: "error", text: "Could not reach Klipy. Check your connection and try again." });
    }
    const result = await saveKlipyKeyAction(typed);
    if (result.ok) {
      // Once saved the key leaves the page: it is never shown again.
      setKey("");
      setNote({ kind: "ok", text: "Saved. GIF search is on." });
      router.refresh();
    } else {
      setNote({ kind: "error", text: result.message });
    }
  }

  return (
    <div className="stack">
      <form
        noValidate
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setNote(null);
          start(save);
        }}
      >
        <div className="field">
          <label htmlFor="klipyKey">Klipy API key</label>
          <input
            id="klipyKey"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={state === "off" ? "Paste your key" : "Key saved"}
            aria-describedby="klipyKey-note"
            aria-invalid={note?.kind === "error" ? true : undefined}
            onChange={(event) => setKey(event.target.value)}
          />
          <p id="klipyKey-note" className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
            {note?.text ??
              (state === "off"
                ? "Get a free key at klipy.com. It is tried with Klipy before it is saved."
                : "A key is saved and cannot be shown again. Paste a new one to replace it.")}
          </p>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Checking" : state === "off" ? "Save and turn on" : "Replace key"}
          </button>
        </div>
      </form>

      {state !== "off" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              await removeKlipyKeyAction();
              setNote(null);
              router.refresh();
            });
          }}
        >
          <ConfirmButton label="Remove key and turn off" confirmLabel="Yes, remove" className="btn btn-ghost" />
        </form>
      ) : null}
    </div>
  );
}
