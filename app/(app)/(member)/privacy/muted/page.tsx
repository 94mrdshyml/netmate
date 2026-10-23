import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listMuted } from "@/server/privacy";
import { EmptyState } from "../../_components/empty-state";
import { PageHeader } from "../../_components/page-header";
import { UndoRow } from "../undo-row";

export const dynamic = "force-dynamic";

export const metadata = { title: "Muted people" };

export default async function MutedPage() {
  const member = await getMember();
  if (!member) return null;
  const { env } = await getCloudflareContext({ async: true });
  const people = await listMuted(getDb(env.DB), member.userId);

  return (
    <main className="column">
      <PageHeader title="Muted people" back={{ href: "/privacy", label: "Back to Privacy" }} />
      {people.length > 0 ? (
        <ul className="people" aria-label="Muted people">
          {people.map((person) => (
            <UndoRow key={person.userId} person={person} kind="mute" />
          ))}
        </ul>
      ) : (
        <EmptyState icon="volume-x" title="Nobody is muted.">
          Muted people stay out of your Home feed and your alerts. They are not told.
        </EmptyState>
      )}
    </main>
  );
}
