"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonView } from "@/server/follows";
import type { PostView } from "@/server/posts";
import { loadMoreAction } from "../feed-actions";
import { PersonRow } from "./person-row";
import { PostCard } from "./post-card";

/** After this many posts the "Mates of your mates" block sits in the list (docs/PRD.md section 8.3). */
const MATES_AFTER = 3;

const keyOf = (post: PostView) => `${post.repostedBy?.userId ?? ""}${post.id}`;

/**
 * The posts of Home. The first page comes from the server; the next ones load as the end comes near, are added below
 * (a post already on the page is dropped), and a button does the same by hand. After the third post a small block
 * suggests people followed by people you follow. Draw it with a new `key` to start again (the page was reloaded).
 */
export function FeedList({
  feed,
  initial,
  nextCursor,
  viewerId,
  now,
  mates,
  endText,
}: {
  feed: "for-you" | "following";
  initial: PostView[];
  nextCursor: string | null;
  viewerId: string;
  now: number;
  mates: PersonView[];
  endText: string;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    const res = await loadMoreAction(feed, cursor).catch(() => ({ ok: false as const }));
    if (res.ok) {
      setItems((all) => {
        const have = new Set(all.map(keyOf));
        return [...all, ...res.items.filter((p) => !have.has(keyOf(p)))];
      });
      setCursor(res.nextCursor);
    } else {
      setFailed(true);
    }
    busy.current = false;
    setLoading(false);
  }, [cursor, feed]);

  useEffect(() => {
    const target = end.current;
    if (!target || !cursor || failed) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, failed, loadMore, items.length]);

  const block =
    mates.length > 0 ? (
      <section key="mates" className="mates" aria-label="Mates of your mates">
        <h2 className="list-title">Mates of your mates</h2>
        <ul className="people">
          {mates.map((person) => (
            <PersonRow key={person.userId} person={person} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <>
      {items.flatMap((post, i) => {
        const card = <PostCard key={keyOf(post)} post={post} viewerId={viewerId} now={now} />;
        return i === MATES_AFTER - 1 && block ? [card, block] : [card];
      })}
      {items.length > 0 && items.length < MATES_AFTER ? block : null}
      {cursor ? (
        <div ref={end} className="feed-end">
          {failed ? (
            <p className="muted" role="status">
              Could not load more posts.
            </p>
          ) : null}
          <button type="button" className="btn btn-ghost more" disabled={loading} onClick={() => void loadMore()}>
            {loading ? "Loading" : failed ? "Try again" : "More posts"}
          </button>
        </div>
      ) : items.length > 0 ? (
        <p className="muted end">{endText}</p>
      ) : null}
    </>
  );
}
