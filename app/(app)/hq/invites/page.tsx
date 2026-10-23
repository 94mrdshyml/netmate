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
      <h1>Invites</h1>

      <section aria-labelledby="quota-heading" className="hq-section">
        <h2 id="quota-heading">Automatic approvals</h2>
        <p className="hint">
          Each member link approves this many sign-ups straight away. Later ones wait in Approvals. Your own link never runs out.
        </p>
        <QuotaForm initial={settings.inviteQuota} />
      </section>

      <section aria-labelledby="links-heading" className="hq-section">
        <h2 id="links-heading">Links</h2>
        <p className="hint">
          If a link has leaked, make a new one. The old one stops working at once. People who already joined stay, and the count of
          people who joined carries over.
        </p>
        <ul className="hq-list" aria-label="Invite links">
          {links.map((l) => {
            const url = inviteUrl(origin, l.code);
            return (
              <li key={l.linkId} className="hq-item">
                <div className="hq-item-text">
                  <strong>{l.ownerName}</strong> <span className="muted">@{l.ownerUsername}</span>
                  {l.isAdmin ? <span className="hq-tag">Admin</span> : null}
                  <div className="hq-meta">
                    {l.usesCount} {l.usesCount === 1 ? "person has" : "people have"} joined
                    {l.isAdmin ? "" : ` (${Math.min(l.usesCount, settings.inviteQuota)} of ${settings.inviteQuota} automatic approvals used)`}
                  </div>
                </div>
                <div className="hq-item-actions">
                  <CopyButton url={url} label={`Copy ${l.ownerName}'s link`} />
                  <form action={regenerateInviteAction}>
                    <input type="hidden" name="linkId" value={l.linkId} />
                    <ConfirmButton label="Make a new link" confirmLabel="Yes, replace it" className="btn btn-ghost" />
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
