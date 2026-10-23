import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/** The sticky header of every screen below Home: a back arrow (when there is somewhere to go back to) and the title. */
export function PageHeader({
  title,
  back,
  sub,
  lead,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  sub?: string;
  /** Something before the title, such as the account menu button on a bottom bar screen. */
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
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
      {children}
    </header>
  );
}
