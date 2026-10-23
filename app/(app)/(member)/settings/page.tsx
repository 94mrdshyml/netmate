import { cookies } from "next/headers";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getInstanceState } from "@/instance/request";
import { THEME_COOKIE, parseThemeChoice } from "@/lib/theme-choice";
import { signOutAction } from "../../sign-in/actions";
import { Avatar } from "../_components/avatar";
import { Icon, type IconName } from "../_components/icon";
import { PageHeader } from "../_components/page-header";
import { ThemeChoicePicker } from "../_components/theme-toggle";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const ROWS: { href: string; label: string; icon: IconName }[] = [
  { href: "/invite", label: "Invite people", icon: "user-plus" },
  { href: "/profile", label: "Edit profile", icon: "edit-2" },
];

// Rows are added here as their screens are built (bookmarks, analytics, privacy, account, admin panel).
export default async function SettingsPage() {
  const member = await getMember();
  if (!member) return null;
  const { settings } = await getInstanceState();
  const chosen = parseThemeChoice((await cookies()).get(THEME_COOKIE)?.value) ?? settings.themeDefault;

  return (
    <main className="column">
      <PageHeader title="Settings" />

      <section className="account" aria-label="Your account">
        <Avatar userId={member.userId} avatarKey={member.avatarKey} size={56} />
        <div className="account-text">
          <strong>
            {member.firstName} {member.lastName}
          </strong>
          <span className="muted">@{member.username}</span>
        </div>
      </section>

      <ul className="rows" aria-label="Settings">
        {ROWS.map((row) => (
          <li key={row.href}>
            <Link href={row.href}>
              <span className="row-icon">
                <Icon name={row.icon} size={18} />
              </span>
              <span className="row-label">{row.label}</span>
              <Icon name="chevron-right" size={18} />
            </Link>
          </li>
        ))}
      </ul>

      <ThemeChoicePicker initial={chosen} />

      <form action={signOutAction}>
        <button type="submit" className="btn btn-ghost btn-block">
          <Icon name="log-out" size={18} />
          Log out
        </button>
      </form>
    </main>
  );
}
