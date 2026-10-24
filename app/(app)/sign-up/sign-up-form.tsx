"use client";

import { useEffect, useState, useTransition } from "react";
import { emailFromHash } from "@/lib/invite-email-hint";
import { signUpAction } from "./actions";

const FIELDS = [
  { name: "firstName", label: "First name", type: "text", autoComplete: "given-name" },
  { name: "lastName", label: "Last name", type: "text", autoComplete: "family-name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "username", label: "Username", type: "text", autoComplete: "username", hint: "3 to 15 letters, numbers or underscores. You cannot change it later." },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 8 characters." },
] as const;

export function SignUpForm({ invite }: { invite: string }) {
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  // A person invited by email arrives with their address after the "#" of the link (it never reaches our server).
  // Fill the Email box once, only if it is still empty, then take the address out of the address bar.
  useEffect(() => {
    const address = emailFromHash(window.location.hash);
    if (!address) return;
    const box = document.getElementById("email");
    if (box instanceof HTMLInputElement && box.value === "") box.value = address;
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) ?? "");
        setBanner(null);
        setErrors({});
        start(async () => {
          const result = await signUpAction({
            invite,
            firstName: value("firstName"),
            lastName: value("lastName"),
            email: value("email"),
            username: value("username"),
            password: value("password"),
          });
          setErrors(result.fieldErrors ?? {});
          setBanner(result.message);
        });
      }}
    >
      {banner ? (
        <p className="banner" role="alert">
          {banner}
        </p>
      ) : null}
      {FIELDS.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            type={f.type}
            className="input"
            autoComplete={f.autoComplete}
            aria-invalid={errors[f.name] ? true : undefined}
            aria-describedby={`${f.name}-note`}
          />
          <p id={`${f.name}-note`} className={errors[f.name] ? "error" : "hint"}>
            {errors[f.name] ?? ("hint" in f ? f.hint : "")}
          </p>
        </div>
      ))}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Creating account" : "Create account"}
      </button>
    </form>
  );
}
