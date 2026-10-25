"use client";

import { useEffect } from "react";
import { markSeenAction } from "../posts/actions";

const VISIBLE_MS = 1000;
const SEND_EVERY_MS = 5000;

/**
 * Tells the server which posts were at least half on screen for a second, so For you ranks them lower next time. It
 * looks for the posts on the page (`data-post-id`), sends them in batches, and sends each only once per page. Nothing
 * is shown, and an error here is never shown either (docs/PRD.md section 8.3).
 */
export function SeenTracker() {
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const pending = new Set<string>();
    const sent = new Set<string>();

    const flush = () => {
      if (pending.size === 0) return;
      const ids = [...pending];
      pending.clear();
      ids.forEach((id) => sent.add(id));
      void markSeenAction(ids).catch(() => {});
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.postId;
          if (!id || sent.has(id)) continue;
          if (entry.isIntersecting) {
            if (timers.has(entry.target)) continue;
            timers.set(
              entry.target,
              setTimeout(() => {
                timers.delete(entry.target);
                if (document.visibilityState === "visible") pending.add(id);
              }, VISIBLE_MS),
            );
          } else {
            clearTimeout(timers.get(entry.target));
            timers.delete(entry.target);
          }
        }
      },
      { threshold: 0.5 },
    );
    document.querySelectorAll("[data-post-id]").forEach((el) => observer.observe(el));
    // Posts that load as you scroll are looked at too.
    const added = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.dataset.postId) observer.observe(node);
          node.querySelectorAll("[data-post-id]").forEach((el) => observer.observe(el));
        });
      }
    });
    added.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });

    const every = setInterval(flush, SEND_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      observer.disconnect();
      added.disconnect();
      timers.forEach((t) => clearTimeout(t));
      clearInterval(every);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);

  return null;
}
