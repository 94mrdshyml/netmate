"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../(member)/_components/icon";
import { sectionFor } from "./sections";

/** Where you are: Admin, the group, then the page (and the tab inside it). "Admin" goes back to the Overview. */
export function HqBreadcrumbs() {
  const pathname = usePathname();
  const { section, tab } = sectionFor(pathname);
  // The group is shown when it adds something: "Settings, then Branding", but not "Home, then Overview" or "Money, then Money".
  const group = section && section.group !== "Home" && section.group !== section.label ? section.group : null;
  const trail: { text: string; href?: string }[] = [];
  if (group) trail.push({ text: group });
  if (section) trail.push(tab ? { text: section.label, href: section.href } : { text: section.label });
  if (tab && tab.label !== section?.label) trail.push({ text: tab.label });
  return (
    <nav className="hq-crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/hq">Admin</Link>
        </li>
        {trail.map((item, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={item.text} aria-current={last ? "page" : undefined}>
              <Icon name="chevron-right" size={14} />
              {item.href && !last ? <Link href={item.href}>{item.text}</Link> : <span>{item.text}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
