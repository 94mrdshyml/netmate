import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listBlocked } from "@/server/privacy";
import { EmptyState } from "../../_components/empty-state";
import { PageHeader } from "../../_components/page-header";
import { UndoRow } from "../undo-row";

export const dynamic = "force-dynamic";

export const metadata = { title: "Blocked people" };

export default async function BlockedPage() {
  const member = await getMember();
  if (!member) return null;
  const { env } = await getCloudflareContext({ async: true });
  const people = await listBlocked(getDb(env.DB), member.userId);

  return (
    <main className="column">
      <PageHeader title="Blocked people" back={{ href: "/privacy", label: "Back to Privacy" }} />
      {people.length > 0 ? (
        <ul className="people" aria-label="Blocked people">
          {people.map((person) => (
            <UndoRow key={person.userId} person={person} kind="block" />
          ))}
        </ul>
      ) : (
        <EmptyState icon="user-x" title="Nobody is blocked.">
          People you block cannot see your posts or find you, and you cannot see theirs. They are not told.
        </EmptyState>
      )}
    </main>
  );
}
