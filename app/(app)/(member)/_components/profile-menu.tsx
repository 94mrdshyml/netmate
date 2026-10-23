"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setBlockAction, setMuteAction } from "../privacy/actions";
import { Icon } from "./icon";

/**
 * The "..." on someone else's profile: Mute or Unmute, and Block. Blocking asks first and says what
 * it does. Neither tells the other person.
 */
export function ProfileMenu({ userId, name, username, muted }: { userId: string; name: string; username: string; muted: boolean }) {
  const router = useRouter();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setConfirming(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        root.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (task: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setError(null);
    start(async () => {
      const result = await task();
      if (result.ok) {
        setOpen(false);
        setConfirming(false);
        router.refresh();
      } else setError(result.message);
    });
  };

  return (
    <span className="post-menu" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`More options for ${name}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setConfirming(false);
          setError(null);
        }}
      >
        <Icon name="more-horizontal" />
      </button>
      {open ? (
        <div className="post-menu-panel">
          {confirming ? (
            <div className="post-menu-confirm" role="group" aria-label={`Block @${username}?`}>
              <p>Block @{username}?</p>
              <p className="hint">They will not see your posts or find you, and you will not see theirs. They are not told.</p>
              <div className="confirm">
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => setBlockAction(userId, true))}>
                  {pending ? "Blocking" : "Block"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="post-menu-item" disabled={pending} onClick={() => run(() => setMuteAction(userId, !muted))}>
                <Icon name="volume-x" />
                <span>{muted ? `Unmute @${username}` : `Mute @${username}`}</span>
              </button>
              <button type="button" className="post-menu-item" onClick={() => setConfirming(true)}>
                <Icon name="slash" />
                <span>Block @{username}</span>
              </button>
            </>
          )}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
