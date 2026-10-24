"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The welcome screen's button. It carries whatever is after the "#" of the page's address on to the sign-up form (a
 * person invited by email has their address there, and an ordinary link would drop it). Without scripts, or with a
 * click that opens a new tab, it is still a plain link.
 */
export function JoinButton({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      className="btn btn-primary btn-block"
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        router.push(href + window.location.hash);
      }}
    >
      {children}
    </a>
  );
}
