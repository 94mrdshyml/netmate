"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { countNewPostsAction } from "../feed-actions";

const EVERY_MS = 30_000;
const CAP = 99;

/**
 * "N new posts" under the top bar (docs/PRD.md section 8.3). Every 30 seconds, while this tab is open on screen, it asks how
 * many posts people you follow have made since the page was drawn. Pressing it goes to the top and draws the page again.
 * Draw it with a new `key` when the page is drawn again, so the count starts from nothing.
 */
export function NewPostsPill({ since }: { since: number }) {
  const router = useRouter();
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
            window.scrollTo({ top: 0 });
            router.refresh();
          }}
        >
          {count > CAP ? `${CAP}+` : count} new {count === 1 ? "post" : "posts"}
        </button>
      ) : null}
    </div>
  );
}
