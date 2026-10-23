import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getPrivacy } from "@/server/privacy";
import { Icon, type IconName } from "../_components/icon";
import { PageHeader } from "../_components/page-header";
import { PrivateSwitch } from "./private-switch";

export const dynamic = "force-dynamic";

export const metadata = { title: "Privacy" };

const count = (n: number, none: string, one: string, many: string) => (n === 0 ? none : n === 1 ? one : `${n} ${many}`);

export default async function PrivacyPage() {
  const member = await getMember();
  if (!member) return null;
  const { env } = await getCloudflareContext({ async: true });
  const privacy = await getPrivacy(getDb(env.DB), member.userId);

  const rows: { href: string; title: string; sub: string; icon: IconName }[] = [
    {
      href: "/privacy/requests",
      title: "Follow requests",
      sub: count(privacy.waiting, "Nobody is waiting", "1 person is waiting", "people are waiting"),
      icon: "user-plus",
    },
    { href: "/privacy/blocked", title: "Blocked people", sub: count(privacy.blocked, "Nobody blocked", "1 person blocked", "people blocked"), icon: "user-x" },
    { href: "/privacy/muted", title: "Muted people", sub: count(privacy.muted, "Nobody muted", "1 person muted", "people muted"), icon: "volume-x" },
  ];

  return (
    <main className="column">
      <PageHeader title="Privacy" back={{ href: "/settings", label: "Back to Settings" }} centered />

      <ul className="settings-list" aria-label="Privacy">
        <li>
          <PrivateSwitch isPrivate={privacy.isPrivate} waiting={privacy.waiting} />
        </li>
        {rows.map((row) => (
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
    </main>
  );
}
