"use client";

import { useState, useTransition } from "react";
import { requestResetAction } from "./actions";

export function ForgotForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <p className="banner" role="status">
        If that address belongs to a member, a link is on its way. It works for an hour. Check your spam folder if it does not show up.
      </p>
    );
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email") ?? "");
        setError(null);
        start(async () => {
          const result = await requestResetAction({ email });
          if (result.ok) setSent(true);
          else setError(result.message);
        });
      }}
    >
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby="email-note"
        />
        <p id="email-note" className={error ? "error" : "hint"} role={error ? "alert" : undefined}>
          {error ?? "The email you signed up with."}
        </p>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sending" : "Send reset link"}
      </button>
    </form>
  );
}
