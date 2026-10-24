import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { readPaymentSettings } from "@/server/payments";
import { signOutAction } from "../../sign-in/actions";
import { Icon, type IconName } from "../_components/icon";
import { PageHeader } from "../_components/page-header";
import { ThemeToggle } from "../_components/theme-toggle";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

type Row = { href: string; title: string; sub: string; icon: IconName };
type Section = { id: string; title: string; rows: Row[] };

// Settings is a few short lists, each under a plain heading: who you are, what is yours, money, safety, and (for staff) running the space.
const ACCOUNT: Section = {
  id: "account",
  title: "Account",
  rows: [
    { href: "/profile", title: "Edit profile", sub: "Name, bio and photos", icon: "user" },
    { href: "/privacy", title: "Privacy", sub: "Private account, blocked and muted people", icon: "lock" },
  ],
};

const YOURS: Section = {
  id: "yours",
  title: "Yours",
  rows: [
    { href: "/bookmarks", title: "Saved posts", sub: "Posts you kept, only visible to you", icon: "bookmark" },
    { href: "/invite", title: "Invite people", sub: "Share your link and see who joined", icon: "user-plus" },
  ],
};

// Shown only while the owner has subscriptions switched on (/hq/money/setup).
const SUBSCRIPTIONS: Section = {
  id: "subscriptions",
  title: "Subscriptions",
  rows: [{ href: "/subscriptions", title: "Subscriptions", sub: "The people you pay, your subscribers and earnings, and your price", icon: "credit-card" }],
};

const SAFETY: Section = {
  id: "safety",
  title: "Safety",
  rows: [{ href: "/reports", title: "Your reports", sub: "Posts you reported and where each case stands", icon: "flag" }],
};

// Only the admin sees this row. /hq checks the role again on the server every time.
const ADMIN: Section = {
  id: "admin",
  title: "Running this space",
  rows: [{ href: "/hq", title: "Admin panel", sub: "People, money and how this space looks", icon: "shield" }],
};

// A moderator gets their own row, straight to the members list. /hq checks the role again on the server every time.
const MODERATOR: Section = {
  id: "moderation",
  title: "Running this space",
  rows: [{ href: "/hq/members", title: "Moderation", sub: "Members and how the community is doing", icon: "shield" }],
};

// The Profile tab in the bottom bar is the one way to your own profile, so it is not a row.
export default async function SettingsPage() {
  const member = await getMember();
  if (!member) return null;
  const { env } = await getCloudflareContext({ async: true });
  const paying = (await readPaymentSettings(getDb(env.DB))).enabled;
  const sections = [ACCOUNT, YOURS, ...(paying ? [SUBSCRIPTIONS] : []), SAFETY, ...(member.role === "admin" ? [ADMIN] : member.moderator ? [MODERATOR] : [])];

  return (
    <main className="column">
      <PageHeader title="Settings" back={{ href: "/", label: "Back to Home" }} centered />

      <ul className="settings-sections" aria-label="Settings">
        {sections.map((section) => (
          <li key={section.id} className="settings-section">
            <h2 id={`settings-${section.id}`} className="settings-heading">
              {section.title}
            </h2>
            <ul className="settings-list" aria-labelledby={`settings-${section.id}`}>
              {section.rows.map((row) => (
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
            </ul>
          </li>
        ))}
        <li className="settings-section">
          <h2 id="settings-look" className="settings-heading">
            Look
          </h2>
          <ul className="settings-list" aria-labelledby="settings-look">
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
