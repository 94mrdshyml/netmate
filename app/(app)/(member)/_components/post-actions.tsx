"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePostAction, setLikeAction } from "../posts/actions";
import { Icon } from "./icon";

export function LikeButton({ postId, liked, count }: { postId: string; liked: boolean; count: number }) {
  const [state, setState] = useState({ liked, count });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        className="action"
        aria-pressed={state.liked}
        aria-label={state.liked ? `Unlike, ${state.count} likes` : `Like, ${state.count} likes`}
        disabled={pending}
        onClick={() => {
          const wanted = !state.liked;
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

export function DeleteButton({ postId, goHomeAfter = false }: { postId: string; goHomeAfter?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="action" aria-label="Delete post" onClick={() => setConfirming(true)}>
        <Icon name="trash-2" />
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label="Delete this post?">
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
        Delete
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}
