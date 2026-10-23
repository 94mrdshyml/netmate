import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/**
 * What a list shows when it has nothing in it: a quiet icon, one plain line, a second line that
 * says what will appear (or what to do), and, where there is something useful to do, one button.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-text">{children}</p> : null}
      {action ? (
        <Link href={action.href} className="btn btn-ghost">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
