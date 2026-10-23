"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "../(member)/_components/icon";
import { HQ_SECTIONS } from "./sections";

export function HqNav({ pending }: { pending: number }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // On a phone the menu is a strip that scrolls sideways: bring the page you are on into view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  const groups = [...new Set(HQ_SECTIONS.map((s) => s.group))];
  return (
    <nav className="hq-nav" aria-label="Admin" ref={nav}>
      {groups.map((group) => (
        <div className="hq-nav-group" key={group}>
          <p className="hq-nav-label">{group}</p>
          {HQ_SECTIONS.filter((s) => s.group === group).map((s) => (
            <Link key={s.href} href={s.href} aria-current={pathname === s.href ? "page" : undefined}>
              <Icon name={s.icon} size={18} />
              <span className="hq-nav-text">{s.label}</span>
              {s.href === "/hq/approvals" && pending > 0 ? (
                <span className="hq-badge" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
