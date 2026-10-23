import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { inviteLinks } from "@/db/schema";
import { getInstanceState } from "@/instance/request";
import { ensureInviteLink, inviteUrl } from "@/server/invites";
import { CopyLink } from "../copy-link";
import { PageHeader } from "../_components/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Invite people" };

export default async function InvitePage() {
  const member = await getMember();
  if (!member) return null;

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const { settings } = await getInstanceState();
  const invite = await ensureInviteLink(db, member.userId);
  const joined =
    (await db.select({ uses: inviteLinks.usesCount }).from(inviteLinks).where(eq(inviteLinks.id, invite.id)).get())?.uses ?? 0;

  const host = (await headers()).get("host") ?? "localhost";
  const origin = env.BETTER_AUTH_URL ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  return (
    <main className="column">
      <PageHeader title="Invite people" back={{ href: "/settings", label: "Back to Settings" }} />
      <div className="stack">
        <p className="lede">
          {member.role === "admin"
            ? "Anyone with this link can join. It never runs out."
            : `The first ${settings.inviteQuota} people who join with this link are approved straight away. Later ones wait for the admin.`}
        </p>
        <CopyLink url={inviteUrl(origin, invite.code)} />
        <p className="stat">
          <strong>{joined}</strong>
          <span>{joined === 1 ? "person has" : "people have"} joined with your link.</span>
        </p>
      </div>
    </main>
  );
}
