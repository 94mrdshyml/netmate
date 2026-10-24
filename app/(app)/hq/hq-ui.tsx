import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../(member)/_components/icon";

// The few building blocks every admin page is made of, so the pages look like one product.

/** The title of a page, one plain line under it, room on the right for a button, and (for a section made of several pages) its tabs. */
export function PageHeader({ title, children, actions, tabs }: { title: string; children?: ReactNode; actions?: ReactNode; tabs?: ReactNode }) {
  return (
    <header className="hq-page-top">
      <div className="hq-page-head">
        <div>
          <h1>{title}</h1>
          {children ? <p className="hq-lede">{children}</p> : null}
        </div>
        {actions ? <div className="hq-page-actions">{actions}</div> : null}
      </div>
      {tabs}
    </header>
  );
}

/** The pages of one section as a row of tabs under the title. Plain links: each tab is its own page, so it works without scripts. */
export function HqTabs({ label, items, current }: { label: string; items: readonly { href: string; label: string }[]; current: string }) {
  return (
    <nav className="hq-tabs" aria-label={label}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The bar above a list: a search field, filter chips and room on the right. One look for every list in the panel. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="hq-toolbar">{children}</div>;
}

/** A flat panel with a hairline edge: an icon and title on top, the content, and an optional footer row. */
export function Card({
  id,
  icon,
  title,
  description,
  aside,
  footer,
  children,
}: {
  id?: string;
  icon?: IconName;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hq-card" aria-labelledby={id}>
      <header className="hq-card-head">
        {icon ? (
          <span className="hq-tile" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
        ) : null}
        <div className="hq-card-title">
          <h2 id={id}>{title}</h2>
          {description ? <p className="hint">{description}</p> : null}
        </div>
        {aside ? <div className="hq-card-aside">{aside}</div> : null}
      </header>
      <div className="hq-card-body">{children}</div>
      {footer ? <footer className="hq-card-foot">{footer}</footer> : null}
    </section>
  );
}

/** A small label with an icon: "needs you" gets the brand outline, "fine" stays quiet. */
export function Pill({ tone = "quiet", icon, children }: { tone?: "quiet" | "attention"; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`hq-pill hq-pill-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

/** The first letter of a name in a quiet round chip. Stands in for a picture, so no request is made. */
export function Initial({ name }: { name: string }) {
  return (
    <span className="hq-initial" aria-hidden="true">
      {Array.from(name.trim())[0]?.toUpperCase() ?? ""}
    </span>
  );
}

/** A number panel: a label, a big number and one quiet line. A link when `href` is given. */
export function Stat({ icon, label, value, note, href }: { icon: IconName; label: string; value: number | string; note: string; href?: string }) {
  const body = (
    <>
      <span className="hq-stat-top">
        <span className="hq-stat-label">{label}</span>
        <span className="hq-tile" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      </span>
      <span className="hq-stat-value">{value}</span>
      <span className="hint">{note}</span>
    </>
  );
  return href ? (
    <Link href={href} className="hq-card hq-stat hq-stat-link">
      {body}
    </Link>
  ) : (
    <div className="hq-card hq-stat">{body}</div>
  );
}
