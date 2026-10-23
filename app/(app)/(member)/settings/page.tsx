import Link from "next/link";
import { getMember } from "@/auth/session";
import { signOutAction } from "../../sign-in/actions";
import { Icon, type IconName } from "../_components/icon";
import { PageHeader } from "../_components/page-header";
import { ThemeToggle } from "../_components/theme-toggle";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

type Row = { href: string; title: string; sub: string; icon: IconName };

const ROWS: Row[] = [
  { href: "/profile", title: "Edit profile", sub: "Name, bio and photos", icon: "user" },
  { href: "/invite", title: "Invite people", sub: "Share your link and see who joined", icon: "user-plus" },
  { href: "/privacy", title: "Privacy", sub: "Private account, blocked and muted people", icon: "lock" },
];

// Only the admin sees this row. /hq checks the role again on the server every time.
const ADMIN_ROW: Row = { href: "/hq", title: "Admin panel", sub: "Approvals, invites and how this space looks", icon: "shield" };

// Rows are added here as their screens are built (bookmarks, analytics, privacy, account).
// The Profile tab in the bottom bar is the one way to your own profile, so it is not a row.
export default async function SettingsPage() {
  const member = await getMember();
  if (!member) return null;

  return (
    <main className="column">
      <PageHeader title="Settings" back={{ href: "/", label: "Back to Home" }} centered />

      <ul className="settings-list" aria-label="Settings">
        {(member.role === "admin" ? [...ROWS, ADMIN_ROW] : ROWS).map((row) => (
          <li key={row.href}>
            <Link href={row.href} className="srow">
              <span className="srow-icon">
                <Icon name={row.icon} size={22} />
              </span>
              <span className="srow-text">
                <span className="srow-title">{row.title}</span>
                <span className="srow-sub">{row.sub}</span>
              </span>
              <Icon name="chevron-right" size={18} />
            </Link>
          </li>
        ))}
        <li>
          <div className="srow srow-static">
            <span className="srow-icon" aria-hidden="true" />
            <span className="srow-text">
              <span className="srow-title">Dark or light theme</span>
            </span>
            <ThemeToggle />
          </div>
        </li>
      </ul>

      <form action={signOutAction} className="settings-logout">
        <button type="submit" className="btn btn-ghost btn-block">
          Log out
        </button>
      </form>
    </main>
  );
}
