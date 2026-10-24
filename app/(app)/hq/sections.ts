import type { IconName } from "../(member)/_components/icon";

// The admin panel's pages, in one place. The side menu and the breadcrumbs both read this list, so a
// new page is added here once.
export const HQ_SECTIONS: readonly { href: string; label: string; icon: IconName; group: string }[] = [
  { href: "/hq", label: "Overview", icon: "grid", group: "General" },
  { href: "/hq/approvals", label: "Approvals", icon: "user-check", group: "People" },
  { href: "/hq/invites", label: "Invites", icon: "user-plus", group: "People" },
  { href: "/hq/branding", label: "Branding", icon: "droplet", group: "Community" },
  { href: "/hq/email", label: "Email", icon: "mail", group: "Community" },
  { href: "/hq/services", label: "Services", icon: "settings", group: "Community" },
  { href: "/hq/demo", label: "Demo data", icon: "users", group: "Community" },
];
