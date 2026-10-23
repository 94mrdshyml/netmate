import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { countPending } from "@/server/admin";
import { isEmailSetUp } from "@/server/email";
import { HqNav } from "./hq-nav";

// The admin panel: the only wide layout in the app (CLAUDE.md architecture invariants). The admin
// check runs here and again in every page and action; anyone else gets 404.
export const dynamic = "force-dynamic";

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const db = getDb(env.DB);
  const [pending, emailReady] = await Promise.all([countPending(db), isEmailSetUp(db)]);

  return (
    <div className="hq">
      <header className="hq-bar">
        <p className="hq-title">{settings.name} admin</p>
        <Link href="/settings" className="hq-back">
          Back to the app
        </Link>
      </header>
      <div className="hq-body">
        <HqNav pending={pending} />
        <main className="hq-main">
          {emailReady ? null : (
            <p className="banner" role="status">
              Email is not set up, so people are not asked to verify their address, nobody can reset a password, and you share invite links by hand.{" "}
              <Link href="/hq/email">Set up email</Link>
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
