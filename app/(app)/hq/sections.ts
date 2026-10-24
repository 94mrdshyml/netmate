import type { IconName } from "../(member)/_components/icon";

// The admin panel's pages, in one place. The side menu and the breadcrumbs both read this list, so a
// new page is added here once.
// `staff` marks the pages a moderator may also open; everything else is for the admin alone.
export const HQ_SECTIONS: readonly { href: string; label: string; icon: IconName; group: string; staff?: true }[] = [
  { href: "/hq", label: "Overview", icon: "grid", group: "General" },
  { href: "/hq/stats", label: "Activity", icon: "bar-chart", group: "General", staff: true },
  { href: "/hq/cases", label: "Reports", icon: "flag", group: "People", staff: true },
  { href: "/hq/approvals", label: "Approvals", icon: "user-check", group: "People" },
  { href: "/hq/invites", label: "Invites", icon: "user-plus", group: "People" },
  { href: "/hq/members", label: "Members", icon: "users", group: "People", staff: true },
  { href: "/hq/branding", label: "Branding", icon: "droplet", group: "Community" },
  { href: "/hq/email", label: "Email", icon: "mail", group: "Community" },
  { href: "/hq/payments", label: "Payments", icon: "credit-card", group: "Community" },
  { href: "/hq/revenue", label: "Revenue", icon: "bar-chart", group: "Community" },
  { href: "/hq/services", label: "Services", icon: "settings", group: "Community" },
  { href: "/hq/demo", label: "Demo data", icon: "users", group: "Community" },
];
