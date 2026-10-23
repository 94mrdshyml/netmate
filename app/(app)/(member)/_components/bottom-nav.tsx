"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { unreadAlertCountAction } from "../notifications/actions";
import { Icon, type IconName } from "./icon";

const POLL_MS = 60_000;

export function BottomNav({ username, unread }: { username: string; unread: number }) {
  const pathname = usePathname();
  const onAlerts = pathname.startsWith("/notifications");

  // The page gives the count it knew when it was drawn. Later the bar asks again, so a navigation
  // inside the app (which does not redraw this bar) and a minute of waiting both pick up new alerts.
  const [count, setCount] = useState(unread);
  const [drawnWith, setDrawnWith] = useState(unread);
  if (unread !== drawnWith) {
    setDrawnWith(unread);
    setCount(unread);
  }
  const first = useRef(true);
  useEffect(() => {
    if (onAlerts) return; // The Alerts screen marks everything read, so the badge hides while you are on it.
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const n = await unreadAlertCountAction();
        if (!stopped) setCount(n);
      } catch {
        // Offline or signed out: keep what is shown.
      }
    };
    if (first.current) first.current = false;
    else void refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname, onAlerts]);

  const badge = onAlerts ? 0 : count;
  const items: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: "/", label: "Home", icon: "home", active: pathname === "/" },
    { href: "/search", label: "Search", icon: "search", active: pathname.startsWith("/search") },
    { href: "/notifications", label: "Alerts", icon: "bell", active: onAlerts },
    { href: `/${username}`, label: "Profile", icon: "user", active: pathname === `/${username}` },
  ];

  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((item) => {
        const unreadHere = item.href === "/notifications" ? badge : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            aria-label={unreadHere > 0 ? `${item.label}, ${unreadHere} unread` : undefined}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={24} strokeWidth={item.active ? 2.5 : 1.75} />
              {unreadHere > 0 ? (
                <span className="nav-badge" aria-hidden="true">
                  {unreadHere > 99 ? "99+" : unreadHere}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
