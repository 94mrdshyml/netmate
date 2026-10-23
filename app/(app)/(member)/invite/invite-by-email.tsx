"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { sendInviteEmailAction } from "./actions";

type Note = { kind: "ok" | "error"; text: string };

export function InviteByEmail({ emailReady, isAdmin }: { emailReady: boolean; isAdmin: boolean }) {
  const [note, setNote] = useState<Note | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  if (!emailReady) {
    return (
      <section className="stack" aria-labelledby="by-email">
        <h2 id="by-email">Invite by email</h2>
        <p className="hint">
          Email is not set up, so share your link by hand.
          {isAdmin ? (
            <>
              {" "}
              <Link href="/hq/email">Set up email</Link>
            </>
          ) : null}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="by-email">
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const email = input.current?.value ?? "";
          setNote(null);
          start(async () => {
            const result = await sendInviteEmailAction({ email });
            if (result.ok) {
              setNote({ kind: "ok", text: "Invite sent." });
              if (input.current) input.current.value = "";
            } else {
              setNote({ kind: "error", text: result.message });
            }
          });
        }}
      >
        <h2 id="by-email">Invite by email</h2>
        <div className="field">
          <label htmlFor="invite-email">Their email address</label>
          <input
            ref={input}
            id="invite-email"
            name="email"
            type="email"
            className="input"
            autoComplete="off"
            inputMode="email"
            aria-invalid={note?.kind === "error" ? true : undefined}
            aria-describedby="invite-email-note"
          />
          <p
            id="invite-email-note"
            className={note?.kind === "error" ? "error" : "hint"}
            role={note?.kind === "error" ? "alert" : "status"}
          >
            {note?.text ?? "We will email them your invite link."}
          </p>
        </div>
        <button type="submit" className="btn btn-ghost btn-block" disabled={pending}>
          {pending ? "Sending" : "Send invite"}
        </button>
      </form>
    </section>
  );
}
