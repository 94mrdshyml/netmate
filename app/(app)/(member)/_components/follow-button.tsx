"use client";

import { useState, useTransition } from "react";
import type { FollowState } from "@/server/follows";
import { setFollowAction } from "../people/actions";

/**
 * Follow, Following (Unfollow under a mouse), or Requested for a private account that has not
 * answered yet. Tapping Requested takes the request back.
 */
export function FollowButton({ userId, name, state: initial }: { userId: string; name: string; state: FollowState }) {
  const [state, setState] = useState<FollowState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = state !== "none";

  return (
    <>
      <button
        type="button"
        className={on ? "btn btn-ghost" : "btn btn-primary"}
        aria-pressed={on}
        aria-label={state === "following" ? `Following ${name}. Tap to unfollow` : state === "requested" ? `Requested to follow ${name}. Tap to cancel` : `Follow ${name}`}
        disabled={pending}
        onClick={() => {
          const before = state;
          // Show the change at once, then settle on what the server says (a private account answers "requested").
          setState(on ? "none" : "following");
          setError(null);
          start(async () => {
            const result = await setFollowAction(userId, !on);
            if (result.ok) setState(result.state);
            else {
              setState(before);
              setError(result.message);
            }
          });
        }}
      >
        {state === "following" ? (
          // With a mouse, "Following" turns into "Unfollow" under the pointer (the button's name stays the same).
          <span className="follow-label" aria-hidden="true">
            <span className="follow-on">Following</span>
            <span className="follow-off">Unfollow</span>
          </span>
        ) : state === "requested" ? (
          "Requested"
        ) : (
          "Follow"
        )}
      </button>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
