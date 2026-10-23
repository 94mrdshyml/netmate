"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/hq", label: "Overview" },
  { href: "/hq/branding", label: "Branding" },
  { href: "/hq/approvals", label: "Approvals" },
  { href: "/hq/invites", label: "Invites" },
  { href: "/hq/email", label: "Email" },
] as const;

export function HqNav({ pending }: { pending: number }) {
  const pathname = usePathname();
  return (
    <nav className="hq-nav" aria-label="Admin">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
          {l.href === "/hq/approvals" && pending > 0 ? (
            <span className="hq-badge" aria-label={`${pending} waiting`}>
              {pending}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
