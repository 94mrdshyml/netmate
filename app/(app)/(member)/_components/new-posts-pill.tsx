"use client";

import { useEffect, useState } from "react";
import { countNewPostsAction } from "../feed-actions";

const EVERY_MS = 30_000;
const CAP = 99;

/**
 * "N new posts" under the top bar (docs/PRD.md section 8.3). Every 30 seconds, while this tab is open on screen, it asks how
 * many posts people you follow have made since the page was drawn. Pressing it loads Home again from the top.
 * The time is the one the page had when it first came; a later redraw of the page (any button that changes something
 * redraws it) does not move it, or posts that arrived meanwhile would stop being counted.
 */
export function NewPostsPill({ since: drawnAt }: { since: number }) {
  const [since] = useState(drawnAt);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void countNewPostsAction(since).then(setCount, () => {});
    };
    const timer = setInterval(check, EVERY_MS);
    return () => clearInterval(timer);
  }, [since]);

  return (
    <div className="new-posts" role="status" aria-live="polite">
      {count > 0 ? (
        <button
          type="button"
          className="btn btn-primary new-posts-pill"
          onClick={() => {
            // A whole new load of the tab you are on, from its first page (so what has loaded below and the count start over).
            const url = new URL(window.location.href);
            url.searchParams.delete("cursor");
            window.location.assign(url);
          }}
        >
          {count > CAP ? `${CAP}+` : count} new {count === 1 ? "post" : "posts"}
        </button>
      ) : null}
    </div>
  );
}
