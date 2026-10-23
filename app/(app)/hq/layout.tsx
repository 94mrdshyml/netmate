import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { countPending } from "@/server/admin";
import { HqNav } from "./hq-nav";

// The admin panel: the only wide layout in the app (CLAUDE.md architecture invariants). The admin
// check runs here and again in every page and action; anyone else gets 404.
export const dynamic = "force-dynamic";

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const pending = await countPending(getDb(env.DB));

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
        <main className="hq-main">{children}</main>
      </div>
    </div>
  );
}
