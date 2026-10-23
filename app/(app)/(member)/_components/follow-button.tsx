"use client";

import { useState, useTransition } from "react";
import { setFollowAction } from "../people/actions";

export function FollowButton({ userId, name, following }: { userId: string; name: string; following: boolean }) {
  const [isFollowing, setIsFollowing] = useState(following);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        className={isFollowing ? "btn btn-ghost" : "btn btn-primary"}
        aria-pressed={isFollowing}
        aria-label={isFollowing ? `Following ${name}. Tap to unfollow` : `Follow ${name}`}
        disabled={pending}
        onClick={() => {
          const wanted = !isFollowing;
          setIsFollowing(wanted);
          setError(null);
          start(async () => {
            const result = await setFollowAction(userId, wanted);
            if (result.ok) setIsFollowing(result.following);
            else {
              setIsFollowing(!wanted);
              setError(result.message);
            }
          });
        }}
      >
        {isFollowing ? (
          // With a mouse, "Following" turns into "Unfollow" under the pointer (the button's name stays the same).
          <span className="follow-label" aria-hidden="true">
            <span className="follow-on">Following</span>
            <span className="follow-off">Unfollow</span>
          </span>
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
