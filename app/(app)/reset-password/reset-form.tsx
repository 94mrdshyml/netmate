"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resetPasswordAction } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, start] = useTransition();

  if (expired) {
    return (
      <p className="banner" role="alert">
        {error} <Link href="/forgot-password">Ask for a new link</Link>
      </p>
    );
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const password = String(new FormData(event.currentTarget).get("password") ?? "");
        setError(null);
        start(async () => {
          const result = await resetPasswordAction({ token, password });
          setError(result.message);
          if (result.code === "expired") setExpired(true);
        });
      }}
    >
      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          aria-invalid={error ? true : undefined}
          aria-describedby="password-note"
        />
        <p id="password-note" className={error ? "error" : "hint"} role={error ? "alert" : undefined}>
          {error ?? "At least 8 characters."}
        </p>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Save new password"}
      </button>
    </form>
  );
}
