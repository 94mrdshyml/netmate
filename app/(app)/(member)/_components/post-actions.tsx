"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deletePostAction, setLikeAction } from "../posts/actions";
import { Icon } from "./icon";

export function LikeButton({ postId, liked, count }: { postId: string; liked: boolean; count: number }) {
  const [state, setState] = useState({ liked, count });
  // True for the moment after you like, so the heart pops once (not when the page loads already liked).
  const [popping, setPopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        className={popping ? "action like pop" : "action like"}
        onAnimationEnd={() => setPopping(false)}
        aria-pressed={state.liked}
        aria-label={state.liked ? `Unlike, ${state.count} likes` : `Like, ${state.count} likes`}
        disabled={pending}
        onClick={() => {
          const wanted = !state.liked;
          setPopping(wanted);
          // Show the change at once, then settle on what the server says.
          setState({ liked: wanted, count: Math.max(0, state.count + (wanted ? 1 : -1)) });
          setError(null);
          start(async () => {
            const result = await setLikeAction(postId, wanted);
            if (result.ok) setState({ liked: result.liked, count: result.likeCount });
            else {
              setState({ liked: !wanted, count: state.count });
              setError(result.message);
            }
          });
        }}
      >
        <Icon name="heart" filled={state.liked} />
        <span>{state.count}</span>
      </button>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/**
 * The "..." on your own posts. It opens a small menu (today: Delete post), and deleting still asks
 * first. Posts by other people have no menu, because there is nothing in it for them yet.
 */
export function PostMenu({ postId, goHomeAfter = false }: { postId: string; goHomeAfter?: boolean }) {
  const router = useRouter();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Near the bottom of the screen the menu opens upward so it is never hidden behind the bar.
  const [up, setUp] = useState(false);
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

  return (
    <span className="post-menu action-end" ref={root}>
      <button
        type="button"
        className="action"
        aria-label="More options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (!open && root.current) setUp(window.innerHeight - root.current.getBoundingClientRect().bottom < 200);
          setOpen(!open);
          setConfirming(false);
        }}
      >
        <Icon name="more-horizontal" />
      </button>
      {open ? (
        <div className={up ? "post-menu-panel up" : "post-menu-panel"}>
          {confirming ? (
            <div className="post-menu-confirm" role="group" aria-label="Delete this post?">
              <p>Delete this post?</p>
              <div className="confirm">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await deletePostAction(postId);
                      if (goHomeAfter) router.push("/");
                      else router.refresh();
                    })
                  }
                >
                  {pending ? "Deleting" : "Delete"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setConfirming(false);
                    setOpen(false);
                  }}
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="post-menu-item" onClick={() => setConfirming(true)}>
              <Icon name="trash-2" />
              <span>Delete post</span>
            </button>
          )}
        </div>
      ) : null}
    </span>
  );
}
