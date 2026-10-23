"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateProfileAction } from "../people/actions";

type Values = { firstName: string; lastName: string; bio: string; location: string; link: string };

const FIELDS = [
  { name: "firstName", label: "First name", max: 50 },
  { name: "lastName", label: "Last name", max: 50 },
  { name: "bio", label: "Bio", max: 160, multiline: true },
  { name: "location", label: "City or country", max: 60 },
  { name: "link", label: "Link", max: 100, hint: "For example riya.dev" },
] as const;

export function EditProfileForm({ username, initial }: { username: string; initial: Values }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setBanner(null);
        start(async () => {
          const result = await updateProfileAction(values);
          if (result.ok) {
            setBanner({ kind: "ok", text: "Saved." });
            router.refresh();
          } else {
            setErrors(result.fieldErrors);
            setBanner({ kind: "error", text: result.code === "failed" ? "Could not save. Try again." : "Some answers need fixing." });
          }
        });
      }}
    >
      {banner ? (
        <p className="banner" role={banner.kind === "error" ? "alert" : "status"}>
          {banner.text}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" className="input" value={`@${username}`} readOnly aria-describedby="username-note" />
        <p id="username-note" className="hint">
          Your username cannot be changed.
        </p>
      </div>

      {FIELDS.map((f) => {
        const common = {
          id: f.name,
          name: f.name,
          className: f.name === "bio" ? "input textarea" : "input",
          value: values[f.name],
          maxLength: f.max + 20, // lets people paste a bit too much and see the message
          "aria-invalid": errors[f.name] ? true : undefined,
          "aria-describedby": `${f.name}-note`,
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [f.name]: e.target.value }),
        };
        return (
          <div className="field" key={f.name}>
            <label htmlFor={f.name}>{f.label}</label>
            {"multiline" in f ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
            <p id={`${f.name}-note`} className={errors[f.name] ? "error" : "hint"}>
              {errors[f.name] ?? ("hint" in f ? f.hint : "")}
            </p>
          </div>
        );
      })}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </button>
    </form>
  );
}
