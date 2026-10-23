"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "../_components/avatar";
import { updateProfileAction } from "../people/actions";

type Values = { firstName: string; lastName: string; bio: string; location: string; link: string };
type Pictures = { avatarKey: string | null; bannerKey: string | null };
type Kind = "avatar" | "banner";

const FIELDS = [
  { name: "firstName", label: "First name", max: 50 },
  { name: "lastName", label: "Last name", max: 50 },
  { name: "bio", label: "Bio", max: 160, multiline: true },
  { name: "location", label: "City or country", max: 60 },
  { name: "link", label: "Link", max: 100, hint: "For example riya.dev" },
] as const;

const PICTURES = {
  avatar: { label: "Profile picture", hint: "Up to 2 MB. JPEG, PNG, WebP or GIF." },
  banner: { label: "Cover picture", hint: "Up to 5 MB. Shown 3 times wider than tall." },
} as const;

export function EditProfileForm({
  username,
  userId,
  pictures,
  initial,
}: {
  username: string;
  userId: string;
  pictures: Pictures;
  initial: Values;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  // `undefined` = not touched (kept as it is), `null` = removed, a string = a newly uploaded key.
  const [chosen, setChosen] = useState<{ avatar?: string | null; banner?: string | null }>({});
  const [uploading, setUploading] = useState<Kind | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const current = (kind: Kind): string | null => (kind in chosen ? (chosen[kind] ?? null) : kind === "avatar" ? pictures.avatarKey : pictures.bannerKey);

  async function upload(kind: Kind, file: File | undefined) {
    if (!file) return;
    setErrors((e) => ({ ...e, [kind]: "" }));
    setUploading(kind);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { key?: string; message?: string };
      if (res.ok && data.key) setChosen((c) => ({ ...c, [kind]: data.key }));
      else setErrors((e) => ({ ...e, [kind]: data.message ?? "The picture could not be saved. Try again." }));
    } catch {
      setErrors((e) => ({ ...e, [kind]: "The picture could not be sent. Check your connection and try again." }));
    } finally {
      setUploading(null);
    }
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setBanner(null);
        start(async () => {
          const result = await updateProfileAction({ ...values, ...("avatar" in chosen ? { avatarKey: chosen.avatar } : {}), ...("banner" in chosen ? { bannerKey: chosen.banner } : {}) });
          if (result.ok) {
            setBanner({ kind: "ok", text: "Saved." });
            setChosen({});
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

      {(Object.keys(PICTURES) as Kind[]).map((kind) => {
        const key = current(kind);
        return (
          <div className="field" key={kind}>
            <label htmlFor={`${kind}-file`}>{PICTURES[kind].label}</label>
            <div className="picture-row">
              {kind === "avatar" ? (
                <Avatar userId={userId} avatarKey={key} size={64} />
              ) : key ? (
                <Image className="banner-img" src={`/media/${key}`} alt="" width={240} height={80} unoptimized />
              ) : (
                <div className="banner-img banner-flat" aria-hidden="true" />
              )}
              <input
                id={`${kind}-file`}
                className="file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploading !== null}
                aria-describedby={`${kind}-note`}
                onChange={(e) => {
                  void upload(kind, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {key ? (
                <button type="button" className="btn btn-ghost" onClick={() => setChosen((c) => ({ ...c, [kind]: null }))}>
                  Remove
                </button>
              ) : null}
            </div>
            <p id={`${kind}-note`} className={errors[kind] ? "error" : "hint"} role={errors[kind] ? "alert" : undefined}>
              {uploading === kind ? "Uploading" : errors[kind] || PICTURES[kind].hint}
            </p>
          </div>
        );
      })}

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

      <button type="submit" className="btn btn-primary" disabled={pending || uploading !== null}>
        {pending ? "Saving" : "Save"}
      </button>
    </form>
  );
}
