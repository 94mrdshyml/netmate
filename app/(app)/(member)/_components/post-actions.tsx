"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { deletePostAction, setBookmarkAction, setLikeAction, setRepostAction } from "../posts/actions";
import { Icon } from "./icon";
import { useRemovePost } from "./feed-context";

/** Closes a small panel on an outside tap or Escape (and gives focus back to its button). */
function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
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
    // `close` only sets state, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, root]);
}

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
 * The repost button. It opens a small sheet: Repost (or Undo repost) and Quote. A private account's
 * posts have no button at all, and a reply can only be quoted. The server checks every press again.
 */
export function RepostButton({
  postId,
  reposted,
  count,
  share,
}: {
  postId: string;
  reposted: boolean;
  count: number;
  share: "repost_or_quote" | "quote";
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [state, setState] = useState({ reposted, count });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useDismiss(open, () => setOpen(false), root);

  return (
    <span className="post-menu" ref={root}>
      <button
        type="button"
        className="action"
        aria-haspopup="true"
        aria-expanded={open}
        aria-pressed={state.reposted}
        // Not "reposts": the word "posts" in a label would also match the label of the whole list of posts.
        aria-label={`Repost, ${state.count} ${state.count === 1 ? "time" : "times"}`}
        onClick={() => {
          if (!open && root.current) setUp(window.innerHeight - root.current.getBoundingClientRect().bottom < 200);
          setOpen(!open);
          setError(null);
        }}
      >
        <Icon name="repeat" />
        <span>{state.count}</span>
      </button>
      {open ? (
        <div className={up ? "post-menu-panel start up" : "post-menu-panel start"} role="menu" aria-label="Repost">
          {share === "repost_or_quote" ? (
            <button
              type="button"
              role="menuitem"
              className="post-menu-item"
              disabled={pending}
              onClick={() => {
                const wanted = !state.reposted;
                // Show the change at once, then settle on what the server says.
                setState({ reposted: wanted, count: Math.max(0, state.count + (wanted ? 1 : -1)) });
                setOpen(false);
                setError(null);
                start(async () => {
                  const result = await setRepostAction(postId, wanted);
                  if (result.ok) setState({ reposted: result.reposted, count: result.repostCount });
                  else {
                    setState({ reposted: !wanted, count: state.count });
                    setError(result.message);
                  }
                });
              }}
            >
              <Icon name="repeat" />
              <span>{state.reposted ? "Undo repost" : "Repost"}</span>
            </button>
          ) : null}
          <Link role="menuitem" className="post-menu-item" href={`/compose?quote=${postId}`}>
            <Icon name="edit-2" />
            <span>Quote</span>
          </Link>
        </div>
      ) : null}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Saves a post privately. No count is shown, to anyone. */
export function BookmarkButton({ postId, saved }: { postId: string; saved: boolean }) {
  const [on, setOn] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        className="action"
        aria-pressed={on}
        aria-label={on ? "Remove from saved" : "Save post"}
        disabled={pending}
        onClick={() => {
          const wanted = !on;
          setOn(wanted);
          setError(null);
          start(async () => {
            const result = await setBookmarkAction(postId, wanted);
            if (result.ok) setOn(result.saved);
            else {
              setOn(!wanted);
              setError(result.message);
            }
          });
        }}
      >
        <Icon name="bookmark" filled={on} />
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
 * The "..." under a post. On your own post it opens Delete post (which still asks first). On anyone
 * else's it opens Report post, which goes to the report form.
 */
export function PostMenu({ postId, mine, goHomeAfter = false }: { postId: string; mine: boolean; goHomeAfter?: boolean }) {
  const router = useRouter();
  const removeFromList = useRemovePost();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Near the bottom of the screen the menu opens upward so it is never hidden behind the bar.
  const [up, setUp] = useState(false);
  const [pending, start] = useTransition();

  useDismiss(
    open,
    () => {
      setOpen(false);
      setConfirming(false);
    },
    root,
  );

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
                      const result = await deletePostAction(postId);
                      if (result.ok) removeFromList?.(postId);
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
          ) : mine ? (
            <button type="button" className="post-menu-item" onClick={() => setConfirming(true)}>
              <Icon name="trash-2" />
              <span>Delete post</span>
            </button>
          ) : (
            <Link href={`/report/${postId}`} className="post-menu-item">
              <Icon name="flag" />
              <span>Report post</span>
            </Link>
          )}
        </div>
      ) : null}
    </span>
  );
}
