import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { countPending } from "@/server/admin";
import { isEmailSetUp } from "@/server/email";
import { countOpenCases } from "@/server/reports";
import { Icon } from "../(member)/_components/icon";
import { ThemeToggle } from "../(member)/_components/theme-toggle";
import { HqBreadcrumbs } from "./hq-breadcrumbs";
import { HqNav } from "./hq-nav";
import { HqSearch } from "./hq-search";
import { HQ_SECTIONS, MONEY_TABS } from "./sections";

// The admin panel: the only wide layout in the app (CLAUDE.md architecture invariants). A side menu
// on a wide screen, a strip along the top on a phone. The admin check runs here and again in every
// page and action; anyone else gets 404.
export const dynamic = "force-dynamic";

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const isAdmin = staff.role === "admin";
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const db = getDb(env.DB);
  // The waiting-for-approval count and the email notice are for the admin; a moderator is not shown them.
  const [pending, emailReady] = isAdmin ? await Promise.all([countPending(db), isEmailSetUp(db)]) : [0, true];
  // Open report cases the person may handle (a moderator never counts one about themselves).
  const cases = await countOpenCases(db, { userId: staff.userId, isAdmin });
  const initial = Array.from(settings.name.trim())[0] ?? "";
  // What the quick search may offer: the pages this person can open (and the Money tabs, for the admin).
  const searchItems = [
    ...HQ_SECTIONS.filter((s) => isAdmin || s.staff).map((s) => ({ href: s.href, label: s.label, group: s.group, icon: s.icon, keywords: s.keywords ?? "" })),
    ...(isAdmin ? MONEY_TABS.filter((t) => t.href !== "/hq/money").map((t) => ({ href: t.href, label: t.label, group: "Money", icon: "credit-card" as const, keywords: t.keywords ?? "" })) : []),
  ];

  return (
    <div className="hq">
      <aside className="hq-side">
        <div className="hq-side-head">
          {settings.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own stored logo
            <img className="brand-logo" src={`/media/${settings.logoKey}`} alt="" />
          ) : (
            <span className="brand-chip" aria-hidden="true">
              {initial}
            </span>
          )}
          <p className="hq-title">{settings.name} {isAdmin ? "admin" : "moderation"}</p>
        </div>
        <HqNav pending={pending} cases={cases} isAdmin={isAdmin} />
      </aside>

      <div className="hq-content">
        <header className="hq-top">
          <HqBreadcrumbs />
          <div className="hq-top-actions">
            <HqSearch items={searchItems} canFindMembers />
            <ThemeToggle />
            <Link href="/settings" className="btn btn-ghost hq-back">
              <Icon name="arrow-left" size={18} />
              <span className="hq-back-text">Back to the app</span>
            </Link>
          </div>
        </header>
        <main className="hq-main">
          {emailReady ? null : (
            <p className="banner hq-alert" role="status">
              <Icon name="alert-circle" size={20} />
              <span>
                Email is not set up, so people are not asked to verify their address, nobody can reset a password, and you share invite links by hand.{" "}
                <Link href="/hq/email">Set up email</Link>
              </span>
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
