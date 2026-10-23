import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { readKlipyKey } from "@/server/gifs";
import { Avatar } from "../_components/avatar";
import { Composer } from "../_components/composer";
import { PageHeader } from "../_components/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "New post" };

export default async function ComposePage() {
  const member = await getMember();
  if (!member) return null;
  const { settings } = await getInstanceState();
  const { env } = await getCloudflareContext({ async: true });
  // Klipy's key goes to a signed-in member's browser only while GIF search is on (CLAUDE.md rule 3).
  const gifKey = await readKlipyKey(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY);

  return (
    <main className="column">
      <PageHeader title="New post" back={{ href: "/", label: "Back to Home" }} />
      <Composer autoFocus places={settings.placesEnabled} gifKey={gifKey} leading={<Avatar userId={member.userId} avatarKey={member.avatarKey} size={40} />} />
    </main>
  );
}
