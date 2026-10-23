"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { PostGif } from "@/lib/gif";
import { POST_MAX, countCharacters } from "@/lib/post-text";
import { createPostAction } from "../posts/actions";
import { GifPicker } from "./gif-picker";
import { Icon } from "./icon";
import { PlacePicker } from "./place-picker";

const PHOTO_MAX = 4;

type Photo = { id: number; preview: string; key: string | null; error: string | null };

/** A ring that fills as the post grows; the number shows when 20 or fewer characters are left. */
function Ring({ used }: { used: number }) {
  const left = POST_MAX - used;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, used / POST_MAX);
  return (
    <span className="ring" role="status" aria-live="polite">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke={left < 0 ? "var(--fg)" : "var(--brand-text)"}
          strokeWidth="3"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          transform="rotate(-90 14 14)"
        />
      </svg>
      {left <= 20 ? <span className={left < 0 ? "error" : "muted"}>{left}</span> : <span className="sr-only">{left} characters left</span>}
    </span>
  );
}

export function Composer({
  parentId,
  placeholder = "What is happening?",
  submitLabel = "Post",
  autoFocus = false,
  leading,
  places = false,
  gifKey = null,
}: {
  parentId?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Your picture, shown beside the box. */
  leading?: ReactNode;
  /** Offer "Add a place" (the admin has place suggestions on, and this is a post, not a reply). */
  places?: boolean;
  /** Klipy's key, given only while the admin has GIF search on. Without it there is no GIF button. */
  gifKey?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [place, setPlace] = useState<string | null>(null);
  const [choosingPlace, setChoosingPlace] = useState(false);
  const [gif, setGif] = useState<PostGif | null>(null);
  const [choosingGif, setChoosingGif] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  });
  // The previews are temporary addresses for files on this phone; let them go when the box goes.
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const used = countCharacters(text);
  const uploading = photos.some((p) => p.key === null && p.error === null);
  const failed = photos.some((p) => p.error !== null);
  const hasWords = text.trim().length > 0;
  const hasPhotos = photos.length > 0;
  const blocked = pending || uploading || failed || (!hasWords && !hasPhotos && !gif) || used > POST_MAX;

  async function addPhotos(files: FileList | null) {
    const room = PHOTO_MAX - photos.length;
    const chosen = Array.from(files ?? []).slice(0, Math.max(room, 0));
    if (chosen.length === 0) return;
    const added: Photo[] = chosen.map((file) => ({ id: nextId.current++, preview: URL.createObjectURL(file), key: null, error: null }));
    setPhotos((all) => [...all, ...added]);
    await Promise.all(
      chosen.map(async (file, i) => {
        const id = added[i]!.id;
        const settle = (change: Partial<Photo>) => setPhotos((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)));
        try {
          const body = new FormData();
          body.set("kind", "post");
          body.set("file", file);
          const res = await fetch("/api/upload", { method: "POST", body });
          const data = (await res.json().catch(() => ({}))) as { key?: string; message?: string };
          if (res.ok && data.key) settle({ key: data.key });
          else settle({ error: data.message ?? "The picture could not be saved. Try again." });
        } catch {
          settle({ error: "The picture could not be sent. Check your connection and try again." });
        }
      }),
    );
  }

  function removePhoto(id: number) {
    const gone = photos.find((p) => p.id === id);
    if (gone) URL.revokeObjectURL(gone.preview);
    setPhotos((all) => all.filter((p) => p.id !== id));
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked) return;
        setError(null);
        start(async () => {
          const result = await createPostAction({
            body: text,
            parentId,
            photos: photos.flatMap((p) => (p.key ? [p.key] : [])),
            place: place ?? undefined,
            gif: gif ?? undefined,
          });
          if (result.ok) {
            // A reply stays on the page: clear the box and show it. (A new post goes Home instead.)
            setText("");
            photos.forEach((p) => URL.revokeObjectURL(p.preview));
            setPhotos([]);
            setPlace(null);
            setGif(null);
            router.refresh();
          } else {
            setError(result.message);
          }
        });
      }}
    >
      {error ? (
        <p className="banner" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-row">
        {leading}
        <div className="composer-main">
          <label className="sr-only" htmlFor={`composer-${parentId ?? "new"}`}>
            {parentId ? "Your reply" : "Your post"}
          </label>
          <textarea
            id={`composer-${parentId ?? "new"}`}
            className="composer-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            rows={parentId ? 2 : 6}
            autoFocus={autoFocus}
          />
          {hasPhotos ? (
            <ul className={`composer-photos n${photos.length}`} aria-label="Pictures in this post">
              {photos.map((p, i) => (
                <li key={p.id} className="composer-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a temporary address for a file on this phone */}
                  <img src={p.preview} alt={`Picture ${i + 1}`} />
                  {p.key === null && p.error === null ? <span className="composer-photo-note">Uploading</span> : null}
                  {p.error ? (
                    <span className="composer-photo-note error" role="alert">
                      {p.error}
                    </span>
                  ) : null}
                  <button type="button" className="composer-photo-remove" aria-label={`Remove picture ${i + 1}`} onClick={() => removePhoto(p.id)}>
                    <Icon name="x" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {gif ? (
            <div className="composer-gif" style={{ width: `min(100%, ${gif.width}px)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a picture straight from Klipy, which its rules require */}
              <img src={gif.url} alt={gif.title ?? "The GIF you chose"} width={gif.width} height={gif.height} referrerPolicy="no-referrer" />
              <button type="button" className="composer-photo-remove" aria-label="Remove GIF" onClick={() => setGif(null)}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ) : null}
          {place ? (
            <p className="composer-place">
              <Icon name="map-pin" size={16} />
              <span>{place}</span>
              <button type="button" className="composer-place-remove" aria-label={`Remove place ${place}`} onClick={() => setPlace(null)}>
                <Icon name="x" size={16} />
              </button>
            </p>
          ) : null}
          {choosingPlace ? (
            <PlacePicker
              onPick={(chosen) => {
                setPlace(chosen);
                setChoosingPlace(false);
              }}
              onClose={() => setChoosingPlace(false)}
            />
          ) : null}
          {choosingGif && gifKey ? (
            <GifPicker
              gifKey={gifKey}
              onPick={(chosen) => {
                setGif(chosen);
                setChoosingGif(false);
              }}
              onClose={() => setChoosingGif(false)}
            />
          ) : null}
        </div>
      </div>
      <div className="composer-bar">
        <div className="composer-tools">
          <input
            ref={picker}
            className="sr-only"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={gif ? "Add pictures (not with a GIF)" : photos.length >= PHOTO_MAX ? "Add pictures (4 is the most)" : "Add pictures"}
            disabled={photos.length >= PHOTO_MAX || pending || gif !== null}
            onClick={() => picker.current?.click()}
          >
            <Icon name="image" />
          </button>
          {gifKey ? (
            <button
              type="button"
              className="icon-btn gif-btn"
              aria-label={hasPhotos ? "Add a GIF (not with pictures)" : gif ? "Change GIF" : "Add a GIF"}
              aria-expanded={choosingGif}
              disabled={hasPhotos || pending}
              onClick={() => {
                setChoosingPlace(false);
                setChoosingGif((open) => !open);
              }}
            >
              GIF
            </button>
          ) : null}
          {places ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={place ? "Change place" : "Add a place"}
              aria-expanded={choosingPlace}
              disabled={pending}
              onClick={() => {
                setChoosingGif(false);
                setChoosingPlace((open) => !open);
              }}
            >
              <Icon name="map-pin" />
            </button>
          ) : null}
        </div>
        <div className="composer-send">
          <Ring used={used} />
          <button type="submit" className="btn btn-primary" disabled={blocked}>
            {pending ? "Posting" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
