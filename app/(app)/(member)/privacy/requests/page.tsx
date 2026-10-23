import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listFollowRequests } from "@/server/privacy";
import { EmptyState } from "../../_components/empty-state";
import { PageHeader } from "../../_components/page-header";
import { RequestRow } from "../request-row";

export const dynamic = "force-dynamic";

export const metadata = { title: "Follow requests" };

export default async function FollowRequestsPage() {
  const member = await getMember();
  if (!member) return null;
  const { env } = await getCloudflareContext({ async: true });
  const people = await listFollowRequests(getDb(env.DB), member.userId);

  return (
    <main className="column">
      <PageHeader title="Follow requests" back={{ href: "/privacy", label: "Back to Privacy" }} />
      {people.length > 0 ? (
        <ul className="people" aria-label="Follow requests">
          {people.map((person) => (
            <RequestRow key={person.userId} person={person} />
          ))}
        </ul>
      ) : (
        <EmptyState icon="user-plus" title="Nobody is waiting.">
          When your account is private, people who ask to follow you show up here.
        </EmptyState>
      )}
    </main>
  );
}
