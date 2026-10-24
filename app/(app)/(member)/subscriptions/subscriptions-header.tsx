import Link from "next/link";
import { PageHeader } from "../_components/page-header";

const TABS = [
  { href: "/subscriptions", label: "People I pay" },
  { href: "/subscriptions/earnings", label: "My subscribers" },
  { href: "/subscriptions/price", label: "My price" },
] as const;

/** The top of every Subscriptions screen: the title, and the three screens as tabs. */
export function SubscriptionsHeader({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <>
      <PageHeader title="Subscriptions" back={{ href: "/settings", label: "Back to Settings" }} centered />
      <nav className="tabs" aria-label="Subscriptions">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} replace aria-current={t.href === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
