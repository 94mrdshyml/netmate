"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "../(member)/_components/icon";
import { HQ_SECTIONS } from "./sections";

export function HqNav({ pending, cases, isAdmin }: { pending: number; cases: number; isAdmin: boolean }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // On a phone the menu is a strip that scrolls sideways: bring the page you are on into view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  // A moderator sees only the pages meant for them; every page checks the role again on the server.
  const sections = HQ_SECTIONS.filter((s) => isAdmin || s.staff);
  const groups = [...new Set(sections.map((s) => s.group))];
  return (
    <nav className="hq-nav" aria-label="Admin" ref={nav}>
      {groups.map((group) => (
        <div className="hq-nav-group" key={group}>
          <p className="hq-nav-label">{group}</p>
          {sections.filter((s) => s.group === group).map((s) => (
            <Link key={s.href} href={s.href} aria-current={pathname === s.href || (s.href !== "/hq" && pathname.startsWith(`${s.href}/`)) ? "page" : undefined}>
              <Icon name={s.icon} size={18} />
              <span className="hq-nav-text">{s.label}</span>
              {s.href === "/hq/approvals" && pending > 0 ? (
                <span className="hq-badge" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
              {s.href === "/hq/cases" && cases > 0 ? (
                <span className="hq-badge" aria-label={`${cases} open`}>
                  {cases}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
