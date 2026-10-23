"use client";

import { useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { DEFAULT_AVATAR_STYLE, DEFAULT_INSTANCE_NAME, DEFAULT_THEME } from "@/instance/defaults";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";
import { STEP_FIELDS, validateSetup, type SetupInput, type StepId } from "@/instance/setup-schema";
import { RADII, deriveTheme, type DerivedTheme } from "@/instance/theme";
import { parseHex } from "@/lib/color";
import { completeSetupAction } from "./actions";

const STEPS: { id: StepId; title: string; intro: string }[] = [
  { id: "token", title: "Prove it is you", intro: "Enter the setup token you set when you deployed this instance. It stops anyone else from claiming it." },
  { id: "admin", title: "Your admin account", intro: "You will manage the instance with this account." },
  { id: "identity", title: "Name your instance", intro: "This name appears at the top of every page and in every email." },
  { id: "look", title: "Choose the look", intro: "Pick a colour, corner style and font. Both light and dark are shown." },
  { id: "email", title: "Email (optional)", intro: "Netmate sends sign-up, verification and password emails through Resend. You can add this later." },
  { id: "services", title: "Extras (optional)", intro: "Each of these can be switched on later in the admin panel." },
];

type Values = SetupInput & { placesEnabled: boolean };

const initial: Values = {
  token: "",
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  password: "",
  name: DEFAULT_INSTANCE_NAME,
  primary: DEFAULT_THEME.primary,
  radius: DEFAULT_THEME.radius,
  fontFamily: DEFAULT_THEME.fontFamily as Values["fontFamily"],
  avatarStyle: DEFAULT_AVATAR_STYLE as Values["avatarStyle"],
  resendApiKey: "",
  resendFrom: "",
  klipyApiKey: "",
  placesEnabled: false,
};

export function SetupFlow({ problems }: { problems: string[] }) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  if (problems.length > 0) {
    return (
      <div className="stack">
        <h1>Setup is not ready</h1>
        <p>This deployment is missing some secrets. Set them, deploy again, then reload this page.</p>
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="hint">The setup token is the long random value only you know. Never share it.</p>
      </div>
    );
  }

  const current = STEPS[step] as (typeof STEPS)[number];
  const isLast = step === STEPS.length - 1;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
  };

  /** Errors for the fields on one step only, so later steps are not shouted about early. */
  const stepErrors = (id: StepId): Record<string, string> => {
    const result = validateSetup(values);
    if (result.success) return {};
    const fields: readonly string[] = STEP_FIELDS[id];
    return Object.fromEntries(Object.entries(result.errors).filter(([key]) => fields.includes(key)));
  };

  const next = () => {
    const found = stepErrors(current.id);
    setErrors(found);
    setBanner("");
    if (Object.keys(found).length === 0) setStep((s) => s + 1);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isLast) return next();

    const found = stepErrors(current.id);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBanner("");
    startTransition(async () => {
      // On success the server redirects, so this only returns for a failure.
      const failure = await completeSetupAction(values);
      setErrors(failure.fieldErrors ?? {});
      setBanner(failure.message);
      const firstBad = STEPS.findIndex((s) => STEP_FIELDS[s.id].some((f) => failure.fieldErrors && f in failure.fieldErrors));
      if (firstBad >= 0) setStep(firstBad);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="stack" aria-labelledby="step-title">
      <div>
        <p className="progress">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 id="step-title">{current.title}</h1>
        <p className="muted">{current.intro}</p>
      </div>

      {banner && (
        <p className="banner" role="alert">
          {banner}
        </p>
      )}

      {current.id === "token" && (
        <Field id="token" label="Setup token" error={errors.token}>
          <input
            id="token"
            className="input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={values.token}
            onChange={(e) => set("token", e.target.value)}
            aria-invalid={Boolean(errors.token)}
            aria-describedby={errors.token ? "token-error" : undefined}
          />
        </Field>
      )}

      {current.id === "admin" && (
        <>
          <Text id="firstName" label="First name" value={values.firstName} error={errors.firstName} autoComplete="given-name" onChange={(v) => set("firstName", v)} />
          <Text id="lastName" label="Last name" value={values.lastName} error={errors.lastName} autoComplete="family-name" onChange={(v) => set("lastName", v)} />
          <Text id="email" label="Email" type="email" value={values.email} error={errors.email} autoComplete="email" onChange={(v) => set("email", v)} />
          <Text
            id="username"
            label="Username"
            hint="3 to 15 letters, numbers or underscores. It cannot be changed later."
            value={values.username}
            error={errors.username}
            autoComplete="username"
            onChange={(v) => set("username", v)}
          />
          <Text id="password" label="Password" type="password" hint="At least 8 characters." value={values.password} error={errors.password} autoComplete="new-password" onChange={(v) => set("password", v)} />
        </>
      )}

      {current.id === "identity" && (
        <Text id="name" label="Instance name" hint="Up to 30 characters, for example your school or family name." value={values.name} error={errors.name} onChange={(v) => set("name", v)} />
      )}

      {current.id === "look" && <LookStep values={values} errors={errors} set={set} />}

      {current.id === "email" && (
        <>
          <Text
            id="resendApiKey"
            label="Resend API key"
            type="password"
            hint="Starts with re_. We check it with Resend before saving."
            value={values.resendApiKey ?? ""}
            error={errors.resendApiKey}
            autoComplete="off"
            onChange={(v) => set("resendApiKey", v)}
          />
          <Text
            id="resendFrom"
            label="Send emails from"
            type="email"
            hint="An address on a domain you have verified in Resend."
            value={values.resendFrom ?? ""}
            error={errors.resendFrom}
            onChange={(v) => set("resendFrom", v)}
          />
          {!values.resendApiKey && (
            <p className="hint">
              Without email, people cannot verify their address or reset a password, and invite links must be shared by hand.
            </p>
          )}
        </>
      )}

      {current.id === "services" && (
        <>
          <Text
            id="klipyApiKey"
            label="Klipy API key (GIF search)"
            type="password"
            hint="Leave empty to hide the GIF button."
            value={values.klipyApiKey ?? ""}
            error={errors.klipyApiKey}
            autoComplete="off"
            onChange={(v) => set("klipyApiKey", v)}
          />
          <div className="field">
            <label>
              <input type="checkbox" checked={values.placesEnabled} onChange={(e) => set("placesEnabled", e.target.checked)} /> Suggest cities and countries on profiles
            </label>
            <p className="hint">Uses the free Photon service. When off, location is a plain text field.</p>
          </div>
        </>
      )}

      <div className="actions">
        <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>
          Back
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {isLast ? (pending ? "Setting up" : "Finish setup") : "Next"}
        </button>
      </div>
    </form>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | undefined; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Text({ id, label, value, onChange, error, hint, type = "text", autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string | undefined; hint?: string; type?: string; autoComplete?: string }) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoCapitalize={type === "email" || id === "username" ? "off" : undefined}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
}

function LookStep({ values, errors, set }: { values: Values; errors: Record<string, string>; set: <K extends keyof Values>(key: K, value: Values[K]) => void }) {
  // Keep the last good colour while someone is mid-way through typing a hex value.
  const valid = parseHex(values.primary) !== null;
  const theme: DerivedTheme = deriveTheme(valid ? values.primary : DEFAULT_THEME.primary);
  const adjusted = theme.adjusted.light || theme.adjusted.dark;
  const picker = valid ? (parseHex(values.primary) && values.primary.length === 7 ? values.primary : "#" + deriveTheme(values.primary).light.brand.slice(1)) : DEFAULT_THEME.primary;

  return (
    <>
      <div className="field">
        <label htmlFor="primary">Primary colour</label>
        <div className="colour-row">
          <input type="color" aria-label="Pick a colour" value={picker.toLowerCase()} onChange={(e) => set("primary", e.target.value.toUpperCase())} />
          <input id="primary" className="input" value={values.primary} spellCheck={false} autoCapitalize="characters" onChange={(e) => set("primary", e.target.value)} aria-invalid={Boolean(errors.primary)} aria-describedby={errors.primary ? "primary-error" : undefined} />
        </div>
        {errors.primary && (
          <p className="error" id="primary-error" role="alert">
            {errors.primary}
          </p>
        )}
        {adjusted && (
          <p className="hint" role="status">
            We adjusted this colour slightly in {theme.adjusted.light && theme.adjusted.dark ? "light and dark" : theme.adjusted.light ? "light" : "dark"} mode so text stays easy to read.
          </p>
        )}
      </div>

      <fieldset className="choices" aria-label="Corner style">
        <legend className="label" style={{ gridColumn: "1 / -1" }}>
          Corner style
        </legend>
        {RADIUS_OPTIONS.map((r) => (
          <label className="choice" key={r}>
            <input type="radio" name="radius" value={r} checked={values.radius === r} onChange={() => set("radius", r)} />
            <span style={{ borderRadius: RADII[r] }}>{{ zero: "Square", sm: "Small", md: "Medium", lg: "Round" }[r]}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="fontFamily">Font</label>
        <select id="fontFamily" className="select" value={values.fontFamily} onChange={(e) => set("fontFamily", e.target.value as Values["fontFamily"])}>
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="avatarStyle">Default avatar style</label>
        <select id="avatarStyle" className="select" value={values.avatarStyle} onChange={(e) => set("avatarStyle", e.target.value as Values["avatarStyle"])}>
          {AVATAR_STYLES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="preview-grid" aria-label="Preview">
        <Preview label="Light" mode={theme.light} radius={values.radius} name={values.name} />
        <Preview label="Dark" mode={theme.dark} radius={values.radius} name={values.name} />
      </div>
    </>
  );
}

function Preview({ label, mode, radius, name }: { label: string; mode: DerivedTheme["light"]; radius: Values["radius"]; name: string }) {
  const vars = {
    "--bg": mode.bg,
    "--fg": mode.fg,
    "--brand": mode.brand,
    "--on-brand": mode.onBrand,
    "--brand-hover": mode.brandHover,
    "--brand-pressed": mode.brandPressed,
    "--brand-text": mode.brandText,
    "--radius": RADII[radius],
  } as CSSProperties;

  return (
    <div className="preview" style={vars} data-testid={`preview-${label.toLowerCase()}`}>
      <strong>{name || DEFAULT_INSTANCE_NAME}</strong>
      <span className="muted">{label} mode</span>
      <button type="button" className="btn btn-primary" tabIndex={-1}>
        Follow
      </button>
      <span className="preview-link">A sample link</span>
      <input className="input" readOnly tabIndex={-1} aria-hidden="true" value="A text field" />
    </div>
  );
}
