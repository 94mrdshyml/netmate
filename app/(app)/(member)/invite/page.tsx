import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { inviteLinks } from "@/db/schema";
import { getInstanceState } from "@/instance/request";
import { isEmailSetUp } from "@/server/email";
import { ensureInviteLink, inviteUrl } from "@/server/invites";
import { siteOrigin } from "@/server/origin";
import { CopyLink } from "../copy-link";
import { InviteByEmail } from "./invite-by-email";
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

  const origin = siteOrigin(env, await headers());

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
        <InviteByEmail emailReady={await isEmailSetUp(db)} isAdmin={member.role === "admin"} />
      </div>
    </main>
  );
}
