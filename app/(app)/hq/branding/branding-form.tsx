"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";
import { parseHex } from "@/lib/color";
import { RADII, deriveTheme, type DerivedTheme } from "@/instance/theme";
import { saveBrandingAction } from "../actions";
import { Card } from "../hq-ui";

type Values = { name: string; primary: string; radius: (typeof RADIUS_OPTIONS)[number]; fontFamily: string; avatarStyle: string; logoKey: string | null; faviconKey: string | null };

const CORNER_LABELS = { zero: "Square", sm: "Small", md: "Medium", lg: "Round" } as const;

const FILE_KINDS = {
  logo: { key: "logoKey", label: "Logo", hint: "PNG or SVG, up to 1 MB. Shown beside the name." },
  favicon: { key: "faviconKey", label: "Favicon", hint: "Square PNG, at least 512 pixels wide, or SVG, up to 1 MB. Shown in the browser tab." },
} as const;
type FileKind = keyof typeof FILE_KINDS;

export function BrandingForm({
  initial,
  avatarSamples,
  fontHosted,
}: {
  initial: Values;
  avatarSamples: Record<string, string>;
  fontHosted: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<FileKind | null>(null);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function upload(kind: FileKind, file: File | undefined) {
    if (!file) return;
    setErrors((e) => ({ ...e, [FILE_KINDS[kind].key]: "" }));
    setUploading(kind);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { key?: string; message?: string };
      if (res.ok && data.key) set(FILE_KINDS[kind].key, data.key);
      else setErrors((e) => ({ ...e, [FILE_KINDS[kind].key]: data.message ?? "The file could not be saved. Try again." }));
    } catch {
      setErrors((e) => ({ ...e, [FILE_KINDS[kind].key]: "The file could not be sent. Check your connection and try again." }));
    } finally {
      setUploading(null);
    }
  }

  // Keep the last good colour while someone is part-way through typing a hex value.
  const valid = parseHex(values.primary.trim()) !== null;
  const theme = deriveTheme(valid ? values.primary.trim() : initial.primary);
  const adjusted = theme.adjusted.light || theme.adjusted.dark;
  const picker = valid && values.primary.trim().length === 7 ? values.primary.trim() : theme.light.brand;

  return (
    <form
      className="hq-split"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setNote(null);
        start(async () => {
          const result = await saveBrandingAction(values);
          if (result.ok) {
            setNote({ kind: "ok", text: result.warning ? `Saved. ${result.warning}` : "Saved." });
            router.refresh();
          } else {
            setErrors(result.fieldErrors);
            setNote({ kind: "error", text: result.code === "failed" ? "Could not save. Try again." : "Some answers need fixing." });
          }
        });
      }}
    >
      <div className="hq-col">
        <Card id="identity-heading" icon="feather" title="Identity" description="Your name, logo and the small picture in the browser tab.">
          <div className="stack">
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

            {(Object.keys(FILE_KINDS) as FileKind[]).map((kind) => {
              const { key, label, hint } = FILE_KINDS[kind];
              const stored = values[key];
              return (
                <div className="field" key={kind}>
                  <label htmlFor={`${kind}-file`}>{label}</label>
                  <div className="picture-row">
                    {stored ? (
                      // eslint-disable-next-line @next/next/no-img-element -- our own stored file
                      <img className="brand-file-preview" src={`/media/${stored}`} alt="" />
                    ) : null}
                    <input
                      id={`${kind}-file`}
                      className="file-input"
                      type="file"
                      accept="image/png,image/svg+xml"
                      disabled={uploading !== null}
                      aria-describedby={`${kind}-note`}
                      onChange={(e) => {
                        void upload(kind, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {stored ? (
                      <button type="button" className="btn btn-ghost" onClick={() => set(key, null)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <p id={`${kind}-note`} className={errors[key] ? "error" : "hint"} role={errors[key] ? "alert" : undefined}>
                    {uploading === kind ? "Uploading" : errors[key] || `${hint} Applied when you save.`}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card id="look-heading" icon="droplet" title="Colour and shape" description="Colour, corners and font follow every screen, in light and dark.">
          <div className="stack">
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
              {errors.fontFamily ? (
                <p className="error">{errors.fontFamily}</p>
              ) : (
                <p className="hint">
                  {fontHosted ? "Kept on your own storage, so readers never contact another site." : "Not downloaded yet. Saving downloads it once and keeps it on your own storage."}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card id="avatars-heading" icon="smile" title="Default avatars" description="Drawn for members who have not uploaded a picture.">
          <fieldset className="avatar-choices" aria-label="Default avatar style">
            <legend className="sr-only">Default avatar style</legend>
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
        </Card>
      </div>

      <div className="hq-aside">
        <Card id="preview-heading" icon="eye" title="Preview" description="Updates as you type. Nothing changes for anyone until you save.">
          <div className="preview-grid">
            <Preview label="Light" mode={theme.light} radius={values.radius} name={values.name} />
            <Preview label="Dark" mode={theme.dark} radius={values.radius} name={values.name} />
          </div>
        </Card>
      </div>

      <div className="hq-savebar">
        <p className={note?.kind === "error" ? "error" : "hint"} role={note ? (note.kind === "error" ? "alert" : "status") : undefined}>
          {note?.text ?? ""}
        </p>
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
