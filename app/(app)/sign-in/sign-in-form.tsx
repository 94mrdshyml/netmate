"use client";

import { useState, useTransition } from "react";
import { signInAction } from "./actions";

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        start(async () => {
          const result = await signInAction({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          });
          setError(result.message);
        });
      }}
    >
      {error ? (
        <p className="banner" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
