"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { POST_MAX, countCharacters } from "@/lib/post-text";
import { createPostAction } from "../posts/actions";

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
}: {
  parentId?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Your picture, shown beside the box. */
  leading?: ReactNode;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const used = countCharacters(text);
  const blocked = pending || text.trim().length === 0 || used > POST_MAX;

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked) return;
        setError(null);
        start(async () => {
          const result = await createPostAction({ body: text, parentId });
          if (result.ok) {
            // A reply stays on the page: clear the box and show it. (A new post goes Home instead.)
            setText("");
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
        </div>
      </div>
      <div className="composer-bar">
        <Ring used={used} />
        <button type="submit" className="btn btn-primary" disabled={blocked}>
          {pending ? "Posting" : submitLabel}
        </button>
      </div>
    </form>
  );
}
