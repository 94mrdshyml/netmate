"use client";

import { useEffect, useState } from "react";
import { firstLink } from "@/lib/post-links";
import type { LinkCard } from "@/links/fetch";

type Answer = { card: LinkCard; token: string } | null;

const PAUSE_MS = 400;
const GIVE_UP_MS = 6000;

/**
 * The preview of the first web address in the text of a post, asked for from our server a moment after
 * it is typed or pasted (docs/PRD.md section 8.2). Each address is asked about once. While the answer is
 * on its way `loading` is true; a page with no card, one that is slow, and a refusal all end as "no card",
 * and the post goes ahead without one. `dismiss` is the x on the card: that address is not asked about
 * again and no card goes with the post. `token` is what the post action needs to save the card.
 */
export function useLinkPreview(text: string, enabled: boolean) {
  const url = enabled ? firstLink(text) : null;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [dismissed, setDismissed] = useState<string | null>(null);

  const known = url !== null && url in answers;
  useEffect(() => {
    if (!url || known || url === dismissed) return;
    const mine = new AbortController();
    const timer = setTimeout(async () => {
      const giveUp = setTimeout(() => mine.abort(), GIVE_UP_MS);
      let answer: Answer = null;
      try {
        const res = await fetch("/api/link-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: mine.signal,
        });
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { card?: LinkCard | null; token?: string };
          if (body.card && body.token) answer = { card: body.card, token: body.token };
        }
      } catch {
        // Slow, offline or refused: the post simply has no card.
      } finally {
        clearTimeout(giveUp);
      }
      // A newer address may have replaced this one while it was on its way; the answer is still kept for this address.
      setAnswers((all) => ({ ...all, [url]: answer }));
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      mine.abort();
    };
  }, [url, known, dismissed]);

  const answer = url && url !== dismissed ? (answers[url] ?? null) : null;
  return {
    /** An address is there and its answer has not come yet. */
    loading: url !== null && url !== dismissed && !known,
    /** The address being previewed, for the "getting a preview" line. */
    url: url !== null && url !== dismissed ? url : null,
    card: answer?.card ?? null,
    token: answer?.token ?? null,
    dismiss: () => setDismissed(url),
    reset: () => {
      setAnswers({});
      setDismissed(null);
    },
  };
}
