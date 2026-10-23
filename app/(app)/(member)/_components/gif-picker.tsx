"use client";

import { useEffect, useId, useRef, useState } from "react";
import { klipyUrl, parseKlipyPage, type GifChoice } from "@/lib/gif";
import type { PostGif } from "@/lib/gif";
import { Icon } from "./icon";

const PAUSE_MS = 300;

type Fetched = { ok: true; items: GifChoice[]; hasNext: boolean } | { ok: false; message: string };

/**
 * Asks Klipy straight from this phone: Klipy's rules say searches and pictures must come from the
 * member's own browser, so our server is not in the middle. Results are shown in Klipy's own order.
 */
async function fetchGifs(key: string, query: string, page: number, signal: AbortSignal): Promise<Fetched> {
  try {
    // No cookies and no referrer go to Klipy; the member is not named in the request.
    const res = await fetch(klipyUrl(key, query, page), { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return { ok: false, message: "GIF search is not working right now. Try again later." };
    const page_ = parseKlipyPage(await res.json().catch(() => null));
    if (!page_) return { ok: false, message: "GIF search sent back something we could not read." };
    return { ok: true, ...page_ };
  } catch {
    return { ok: false, message: signal.aborted ? "" : "Could not reach the GIF service. Check your connection." };
  }
}

/** The box that opens from the GIF button: search, tap one, and it is attached to the post. */
export function GifPicker({ gifKey, onPick, onClose }: { gifKey: string; onPick: (gif: PostGif) => void; onClose: () => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifChoice[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  // It starts by asking for what is trending, so it opens busy.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Keeps only the answer to the newest question.
  function settle(mine: AbortController, wanted: number, append: boolean, result: Fetched) {
    if (mine.signal.aborted) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      if (!append) setItems([]);
      setHasNext(false);
      return;
    }
    setItems((all) => (append ? [...all, ...result.items.filter((n) => !all.some((o) => o.id === n.id))] : result.items));
    setHasNext(result.hasNext);
    setPage(wanted);
  }

  function ask(text: string, wanted: number, append: boolean) {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setLoading(true);
    setError(null);
    void fetchGifs(gifKey, text, wanted, mine.signal).then((result) => settle(mine, wanted, append, result));
  }

  useEffect(() => {
    input.current?.focus();
    const mine = new AbortController();
    controller.current = mine;
    void fetchGifs(gifKey, "", 1, mine.signal).then((result) => settle(mine, 1, false, result));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      mine.abort();
      controller.current?.abort();
    };
    // Asking once on opening is all this needs; `settle` only reads the newest controller.
  }, [gifKey]);

  return (
    <div className="gif-picker">
      <div className="gif-field">
        <Icon name="search" size={18} />
        <label htmlFor={`${id}-input`} className="sr-only">
          Search GIFs
        </label>
        <input
          id={`${id}-input`}
          ref={input}
          className="gif-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          // Klipy's rules require exactly this wording.
          placeholder="Search KLIPY"
          maxLength={100}
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (timer.current) clearTimeout(timer.current);
            controller.current?.abort();
            setLoading(true);
            timer.current = setTimeout(() => ask(value, 1, false), PAUSE_MS);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "Enter") {
              // Enter must not post the form.
              event.preventDefault();
            }
          }}
        />
        <button type="button" className="icon-btn" aria-label="Close GIF search" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>

      <p className="hint gif-note" role="status">
        {error ?? (loading ? "Searching" : items.length === 0 ? "No GIFs found. Try other words." : query.trim() === "" ? "Trending now" : "")}
      </p>

      {items.length > 0 ? (
        <ul className="gif-grid" aria-label="GIFs">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="gif-choice" aria-label={`Use GIF: ${item.title}`} onClick={() => onPick(item.post)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture straight from Klipy, which its rules require */}
                <img src={item.preview.url} alt="" width={item.preview.width} height={item.preview.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hasNext && !error ? (
        <button type="button" className="btn btn-ghost gif-more" disabled={loading} onClick={() => ask(query, page + 1, true)}>
          More GIFs
        </button>
      ) : null}

      <p className="hint gif-credit">GIFs come straight from KLIPY to your phone. Powered by KLIPY.</p>
    </div>
  );
}
