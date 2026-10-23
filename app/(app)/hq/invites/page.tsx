import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { requireAdmin } from "@/auth/admin";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { listInviteLinks } from "@/server/admin";
import { inviteUrl } from "@/server/invites";
import { regenerateInviteAction } from "../actions";
import { ConfirmButton } from "../confirm-button";
import { CopyButton } from "../copy-button";
import { Card, Initial, PageHeader, Pill } from "../hq-ui";
import { QuotaForm } from "./quota-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Invites" };

export default async function InvitesPage() {
  await requireAdmin();
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const links = await listInviteLinks(getDb(env.DB));

  const host = (await headers()).get("host") ?? "localhost";
  const origin = env.BETTER_AUTH_URL ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  return (
    <>
      <PageHeader title="Invites">Who can invite people, and how many of them get in without waiting for you.</PageHeader>

      <Card
        id="quota-heading"
        icon="shield"
        title="Automatic approvals"
        description="Each member link approves this many sign-ups straight away. Later ones wait in Approvals. Your own link never runs out."
      >
        <QuotaForm initial={settings.inviteQuota} />
      </Card>

      <Card
        id="links-heading"
        icon="link"
        title="Links"
        description="If a link has leaked, make a new one. The old one stops working at once. People who already joined stay, and the count of people who joined carries over."
        aside={<Pill>{links.length === 1 ? "1 link" : `${links.length} links`}</Pill>}
      >
        <ul className="hq-list" aria-label="Invite links">
          {links.map((l) => {
            const url = inviteUrl(origin, l.code);
            const used = Math.min(l.usesCount, settings.inviteQuota);
            return (
              <li key={l.linkId} className="hq-item">
                <Initial name={l.ownerName} />
                <div className="hq-item-text">
                  <strong>{l.ownerName}</strong> <span className="muted">@{l.ownerUsername}</span>
                  {l.isAdmin ? <span className="hq-tag">Admin</span> : null}
                  <div className="hq-meta">
                    {l.usesCount} {l.usesCount === 1 ? "person has" : "people have"} joined
                    {l.isAdmin ? "" : ` (${used} of ${settings.inviteQuota} automatic approvals used)`}
                  </div>
                  {l.isAdmin || settings.inviteQuota === 0 ? null : (
                    <div className="hq-meter" aria-hidden="true">
                      <span style={{ width: `${Math.round((used / settings.inviteQuota) * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="hq-item-actions">
                  <CopyButton url={url} label={`Copy ${l.ownerName}'s link`} />
                  <form action={regenerateInviteAction}>
                    <input type="hidden" name="linkId" value={l.linkId} />
                    <ConfirmButton label="Make a new link" confirmLabel="Yes, replace it" className="btn btn-ghost" icon="refresh-cw" />
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
