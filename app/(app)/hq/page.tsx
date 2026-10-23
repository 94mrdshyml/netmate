import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { countMembers, countPending } from "@/server/admin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

export default async function HqOverviewPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const [members, pending] = await Promise.all([countMembers(db), countPending(db)]);

  return (
    <>
      <h1>Overview</h1>
      <dl className="hq-stats">
        <div>
          <dt>Members</dt>
          <dd>{members}</dd>
        </div>
        <div>
          <dt>Waiting for approval</dt>
          <dd>{pending}</dd>
        </div>
      </dl>
      {pending > 0 ? (
        <p>
          <Link href="/hq/approvals">
            {pending === 1 ? "1 person is waiting for you to answer." : `${pending} people are waiting for you to answer.`}
          </Link>
        </p>
      ) : (
        <p className="muted">Nobody is waiting for approval.</p>
      )}
    </>
  );
}
