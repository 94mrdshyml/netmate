import type { IconName } from "../(member)/_components/icon";

// The admin panel's pages, in one place. The side menu, the breadcrumbs and the quick search all read this list, so a
// new page is added here once.
// `staff` marks the pages a moderator may also open; everything else is for the admin alone.
// `keywords` are extra words the quick search matches (what a person might type to find the page).
export type HqSection = { href: string; label: string; icon: IconName; group: string; staff?: true; keywords?: string };

export const HQ_SECTIONS: readonly HqSection[] = [
  { href: "/hq", label: "Overview", icon: "grid", group: "Home", keywords: "home dashboard needs you" },
  { href: "/hq/members", label: "Members", icon: "users", group: "People", staff: true, keywords: "people moderators search accounts" },
  { href: "/hq/approvals", label: "Approvals", icon: "user-check", group: "People", keywords: "waiting pending sign-up requests" },
  { href: "/hq/invites", label: "Invites", icon: "user-plus", group: "People", keywords: "links quota join" },
  { href: "/hq/cases", label: "Reports", icon: "flag", group: "People", staff: true, keywords: "cases moderation flagged posts" },
  { href: "/hq/stats", label: "Activity", icon: "bar-chart", group: "Insights", staff: true, keywords: "numbers posts stats growth weeks" },
  { href: "/hq/money", label: "Money", icon: "credit-card", group: "Money", keywords: "revenue payouts subscriptions polar tax fee earnings" },
  { href: "/hq/branding", label: "Branding", icon: "droplet", group: "Settings", keywords: "name logo colour font radius look" },
  { href: "/hq/email", label: "Email", icon: "mail", group: "Settings", keywords: "resend sender verification" },
  { href: "/hq/services", label: "Services", icon: "settings", group: "Settings", keywords: "gif places link previews klipy" },
  { href: "/hq/demo", label: "Demo data", icon: "users", group: "Settings", keywords: "fake people sample posts" },
];

/** The pages inside the Money section. The section is one menu item; these are its tabs. */
export const MONEY_TABS: readonly { href: string; label: string; keywords?: string }[] = [
  { href: "/hq/money", label: "Overview", keywords: "revenue collected tax fee graph month" },
  { href: "/hq/money/payouts", label: "Members and payouts", keywords: "owed record payout subscribers earned" },
  { href: "/hq/money/setup", label: "Polar setup", keywords: "payments keys token webhook split percent fee test mode switch" },
];

/** The section a path belongs to, and the tab inside it when it has one. */
export function sectionFor(pathname: string): { section?: HqSection; tab?: { href: string; label: string } } {
  const section = HQ_SECTIONS.find((s) => s.href === pathname || (s.href !== "/hq" && pathname.startsWith(`${s.href}/`)));
  if (section?.href !== "/hq/money") return { section };
  return { section, tab: MONEY_TABS.find((t) => t.href === pathname) };
}
