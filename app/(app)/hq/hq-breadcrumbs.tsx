"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../(member)/_components/icon";
import { HQ_SECTIONS } from "./sections";

/** Where you are: Admin, then the page. "Admin" goes back to the Overview. */
export function HqBreadcrumbs() {
  const pathname = usePathname();
  const here = HQ_SECTIONS.find((s) => s.href === pathname || (s.href !== "/hq" && pathname.startsWith(`${s.href}/`)));
  return (
    <nav className="hq-crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/hq">Admin</Link>
        </li>
        {here ? (
          <li aria-current="page">
            <Icon name="chevron-right" size={14} />
            <span>{here.label}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
