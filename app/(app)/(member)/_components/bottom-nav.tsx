"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

export function BottomNav({ username }: { username: string }) {
  const pathname = usePathname();
  const items: { href: string; label: string; icon: IconName; active: boolean }[] = [
    { href: "/", label: "Home", icon: "home", active: pathname === "/" },
    { href: `/${username}`, label: "Profile", icon: "user", active: pathname === `/${username}` },
    { href: "/settings", label: "Settings", icon: "settings", active: pathname.startsWith("/settings") },
  ];

  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>
          <Icon name={item.icon} size={24} strokeWidth={item.active ? 2.5 : 1.75} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
