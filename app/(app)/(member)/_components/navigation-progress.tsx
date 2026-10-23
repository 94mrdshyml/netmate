"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Phase = "idle" | "loading" | "done";

const FADE_MS = 350;
// If a move never finishes (offline, an error), the bar goes away on its own.
const GIVE_UP_MS = 12_000;

/**
 * A thin line along the top that starts the moment you tap a link to another screen and finishes
 * when that screen arrives. Pages cannot show their own loading screens (a loading file would make
 * missing pages answer "200" instead of "not found"), so this is how a tap feels answered at once.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const here = `${pathname}?${useSearchParams().toString()}`;
  const [phase, setPhase] = useState<Phase>("idle");
  const [shownFor, setShownFor] = useState(here);

  // A new address means the screen arrived.
  if (here !== shownFor) {
    setShownFor(here);
    if (phase === "loading") setPhase("done");
  }

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      setPhase("loading");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const timer = setTimeout(() => setPhase("idle"), phase === "done" ? FADE_MS : GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return <div className="nav-progress" data-phase={phase} aria-hidden="true" />;
}
