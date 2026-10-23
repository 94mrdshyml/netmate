import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { inviteLinks } from "@/db/schema";
import { getInstanceState } from "@/instance/request";
import { ensureInviteLink, inviteUrl } from "@/server/invites";
import { CopyLink } from "../copy-link";
import { Icon } from "../_components/icon";

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
    <main className="column stack">
      <Link className="back" href="/settings" aria-label="Back to Settings">
        <Icon name="arrow-left" />
      </Link>
      <div>
        <h1>Invite people</h1>
        <p className="hint">
          {member.role === "admin"
            ? "Anyone with this link can join. It never runs out."
            : `The first ${settings.inviteQuota} people who join with this link are approved straight away. Later ones wait for the admin.`}
        </p>
      </div>
      <CopyLink url={inviteUrl(origin, invite.code)} />
      <p>
        <strong>{joined}</strong> {joined === 1 ? "person has" : "people have"} joined with your link.
      </p>
    </main>
  );
}
