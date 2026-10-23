import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/** The sticky header of every screen below Home: a back arrow (when there is somewhere to go back to) and the title. */
export function PageHeader({
  title,
  back,
  sub,
  lead,
  centered = false,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  sub?: string;
  /** Something before the title, such as your picture (the link to Settings) on a bottom bar screen. */
  lead?: ReactNode;
  /** Title in the middle of the bar, with the back arrow at the left (Settings). */
  centered?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={centered ? "page-header page-header-center" : "page-header"}>
      {back ? (
        <Link className="icon-btn back" href={back.href} aria-label={back.label}>
          <Icon name="arrow-left" />
        </Link>
      ) : (
        lead
      )}
      <div className="page-title">
        <h1>{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {children ?? (centered ? <span aria-hidden="true" /> : null)}
    </header>
  );
}
