"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "../_components/avatar";
import { Icon } from "../_components/icon";
import { updateProfileAction } from "../people/actions";

type Values = { firstName: string; lastName: string; bio: string; location: string; link: string };
type Pictures = { avatarKey: string | null; bannerKey: string | null };
type Kind = "avatar" | "banner";

type Field = { name: keyof Values; label: string; max: number; multiline?: boolean; hint?: string };

const NAME_FIELDS: Field[] = [
  { name: "firstName", label: "First name", max: 50 },
  { name: "lastName", label: "Last name", max: 50 },
];
const OTHER_FIELDS: Field[] = [
  { name: "bio", label: "Bio", max: 160, multiline: true },
  { name: "location", label: "City or country", max: 60 },
  { name: "link", label: "Link", max: 100, hint: "For example riya.dev" },
];

const PICTURES = {
  avatar: { label: "Profile picture", hint: "Up to 2 MB. JPEG, PNG, WebP or GIF." },
  banner: { label: "Cover picture", hint: "Up to 5 MB. Shown 3 times wider than tall." },
} as const;

/**
 * Edit profile, laid out like the screens people know: a header with a close button and Save, the
 * cover picture with camera buttons on it, your picture over its corner, then boxed fields that
 * show how many characters are left. Saving keeps you here with a "Saved" note; close goes back.
 */
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
  const avatarKey = current("avatar");
  const bannerKey = current("banner");

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

  const pickPicture = (kind: Kind) => (
    <input
      className="sr-only"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      aria-label={PICTURES[kind].label}
      aria-describedby={`${kind}-note`}
      disabled={uploading !== null}
      onChange={(e) => {
        void upload(kind, e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  const pictureNote = (kind: Kind) => (
    <p id={`${kind}-note`} className={errors[kind] ? "error" : "hint"} role={errors[kind] ? "alert" : undefined}>
      {uploading === kind ? "Uploading" : errors[kind] || PICTURES[kind].hint}
    </p>
  );

  const textField = (f: Field) => {
    const value = values[f.name];
    const common = {
      id: f.name,
      name: f.name,
      className: "tfield-input",
      value,
      maxLength: f.max + 20, // lets people paste a bit too much and see the message
      "aria-invalid": errors[f.name] ? true : undefined,
      "aria-describedby": `${f.name}-note`,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [f.name]: e.target.value }),
    };
    return (
      <div className="tfield-wrap" key={f.name}>
        <div className={errors[f.name] ? "tfield tfield-error" : "tfield"}>
          <div className="tfield-top">
            <label htmlFor={f.name}>{f.label}</label>
            <span className={value.length > f.max ? "tfield-count over" : "tfield-count"} aria-hidden="true">
              {value.length} / {f.max}
            </span>
          </div>
          {f.multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
        </div>
        <p id={`${f.name}-note`} className={errors[f.name] ? "error" : "hint"}>
          {errors[f.name] ?? f.hint ?? ""}
        </p>
      </div>
    );
  };

  return (
    <form
      className="edit"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setBanner(null);
        start(async () => {
          const result = await updateProfileAction({
            ...values,
            ...("avatar" in chosen ? { avatarKey: chosen.avatar } : {}),
            ...("banner" in chosen ? { bannerKey: chosen.banner } : {}),
          });
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
      <header className="page-header edit-header">
        <Link className="icon-btn back" href={`/${username}`} aria-label="Close and go back to your profile">
          <Icon name="x" />
        </Link>
        <div className="page-title">
          <h1>Edit profile</h1>
        </div>
        <button type="submit" className="btn btn-primary edit-save" disabled={pending || uploading !== null}>
          {pending ? "Saving" : "Save"}
        </button>
      </header>

      {banner ? (
        <p className="banner edit-status" role={banner.kind === "error" ? "alert" : "status"}>
          {banner.text}
        </p>
      ) : null}

      <div className="edit-cover">
        {bannerKey ? (
          <Image className="banner-img" src={`/media/${bannerKey}`} alt="" width={480} height={160} unoptimized />
        ) : (
          <div className="banner-img banner-flat" aria-hidden="true" />
        )}
        <div className="edit-cover-actions">
          <label className="pic-btn" title="Change cover picture">
            <Icon name="camera" size={22} />
            {pickPicture("banner")}
          </label>
          {bannerKey ? (
            <button type="button" className="pic-btn" aria-label="Remove cover" title="Remove cover picture" onClick={() => setChosen((c) => ({ ...c, banner: null }))}>
              <Icon name="x" size={22} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="edit-gutter">{pictureNote("banner")}</div>

      <div className="edit-gutter edit-avatar-row">
        <div className="edit-avatar">
          <Avatar userId={userId} avatarKey={avatarKey} size={88} />
          <label className="pic-btn pic-btn-avatar" title="Change profile picture">
            <Icon name="camera" size={22} />
            {pickPicture("avatar")}
          </label>
        </div>
        {avatarKey ? (
          <button type="button" className="btn btn-ghost" aria-label="Remove photo" onClick={() => setChosen((c) => ({ ...c, avatar: null }))}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="edit-gutter">{pictureNote("avatar")}</div>

      <div className="edit-gutter edit-fields">
        <div className="tfield-wrap">
          <div className="tfield tfield-readonly">
            <div className="tfield-top">
              <label htmlFor="username">Username</label>
            </div>
            <input id="username" className="tfield-input" value={`@${username}`} readOnly aria-describedby="username-note" />
          </div>
          <p id="username-note" className="hint">
            Your username cannot be changed.
          </p>
        </div>

        <div className="edit-names">{NAME_FIELDS.map(textField)}</div>
        {OTHER_FIELDS.map(textField)}
      </div>
    </form>
  );
}
