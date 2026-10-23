"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";
import { parseHex } from "@/lib/color";
import { RADII, deriveTheme, type DerivedTheme } from "@/instance/theme";
import { saveBrandingAction } from "../actions";

type Values = { name: string; primary: string; radius: (typeof RADIUS_OPTIONS)[number]; fontFamily: string; avatarStyle: string };

const CORNER_LABELS = { zero: "Square", sm: "Small", md: "Medium", lg: "Round" } as const;

export function BrandingForm({ initial, avatarSamples }: { initial: Values; avatarSamples: Record<string, string> }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  // Keep the last good colour while someone is part-way through typing a hex value.
  const valid = parseHex(values.primary.trim()) !== null;
  const theme = deriveTheme(valid ? values.primary.trim() : initial.primary);
  const adjusted = theme.adjusted.light || theme.adjusted.dark;
  const picker = valid && values.primary.trim().length === 7 ? values.primary.trim() : theme.light.brand;

  return (
    <form
      className="stack hq-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setNote(null);
        start(async () => {
          const result = await saveBrandingAction(values);
          if (result.ok) {
            setNote({ kind: "ok", text: "Saved." });
            router.refresh();
          } else {
            setErrors(result.fieldErrors);
            setNote({ kind: "error", text: result.code === "failed" ? "Could not save. Try again." : "Some answers need fixing." });
          }
        });
      }}
    >
      {note ? (
        <p className="banner" role={note.kind === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          className="input"
          value={values.name}
          maxLength={50}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby="name-note"
          onChange={(e) => set("name", e.target.value)}
        />
        <p id="name-note" className={errors.name ? "error" : "hint"}>
          {errors.name ?? "Up to 30 characters. Shown on the sign-in page and in the tab title."}
        </p>
      </div>

      <div className="field">
        <label htmlFor="primary">Primary colour</label>
        <div className="colour-row">
          <input type="color" aria-label="Pick a colour" value={picker.toLowerCase()} onChange={(e) => set("primary", e.target.value.toUpperCase())} />
          <input
            id="primary"
            className="input"
            value={values.primary}
            spellCheck={false}
            autoCapitalize="characters"
            aria-invalid={errors.primary ? true : undefined}
            aria-describedby="primary-note"
            onChange={(e) => set("primary", e.target.value)}
          />
        </div>
        <p id="primary-note" className={errors.primary ? "error" : "hint"} role={adjusted && !errors.primary ? "status" : undefined}>
          {errors.primary ??
            (adjusted
              ? `We adjust this colour slightly in ${theme.adjusted.light && theme.adjusted.dark ? "light and dark" : theme.adjusted.light ? "light" : "dark"} mode so text stays easy to read.`
              : "Used for buttons and links.")}
        </p>
      </div>

      <fieldset className="choices" aria-label="Corner style">
        <legend className="label" style={{ gridColumn: "1 / -1" }}>
          Corner style
        </legend>
        {RADIUS_OPTIONS.map((r) => (
          <label className="choice" key={r}>
            <input type="radio" name="radius" value={r} checked={values.radius === r} onChange={() => set("radius", r)} />
            <span style={{ borderRadius: RADII[r] }}>{CORNER_LABELS[r]}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="fontFamily">Font</label>
        <select id="fontFamily" className="select" value={values.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {errors.fontFamily ? <p className="error">{errors.fontFamily}</p> : null}
      </div>

      <fieldset className="avatar-choices" aria-label="Default avatar style">
        <legend className="label">Default avatar style</legend>
        <p className="hint">Drawn for members who have not uploaded a picture.</p>
        <div className="avatar-grid">
          {AVATAR_STYLES.map((style) => (
            <label className="avatar-choice" key={style}>
              <input type="radio" name="avatarStyle" value={style} checked={values.avatarStyle === style} onChange={() => set("avatarStyle", style)} />
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture drawn on our own server */}
              <img src={avatarSamples[style]} alt="" width={48} height={48} />
              <span>{style.replace(/-/g, " ")}</span>
            </label>
          ))}
        </div>
        {errors.avatarStyle ? <p className="error">{errors.avatarStyle}</p> : null}
      </fieldset>

      <div className="preview-grid" aria-label="Preview">
        <Preview label="Light" mode={theme.light} radius={values.radius} name={values.name} />
        <Preview label="Dark" mode={theme.dark} radius={values.radius} name={values.name} />
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </button>
      </div>
    </form>
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
      <strong>{name.trim() || "Your name"}</strong>
      <span className="muted">{label} mode</span>
      <button type="button" className="btn btn-primary" tabIndex={-1}>
        Follow
      </button>
      <span className="preview-link">A sample link</span>
      <input className="input" readOnly tabIndex={-1} aria-hidden="true" value="A text field" />
    </div>
  );
}
