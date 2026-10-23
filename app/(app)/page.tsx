import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { ensureInviteLink, inviteUrl } from "@/server/invites";
import { CopyLink } from "./copy-link";
import { signOutAction } from "./sign-in/actions";

// Spike 1 check: a server component can reach the D1 and R2 bindings.
export const dynamic = "force-dynamic";

export default async function Home() {
  const member = await getMember();
  if (!member) redirect("/sign-in");

  const { env } = await getCloudflareContext({ async: true });
  const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  const { settings, configured } = await getInstanceState();
  const invite = await ensureInviteLink(getDb(env.DB), member.userId);
  const host = (await headers()).get("host") ?? "localhost";
  const origin = env.BETTER_AUTH_URL ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  return (
    <main className="column">
      <h1>{settings.name}</h1>
      <p>Signed in as @{member.username}</p>
      <p>D1 binding: {row?.ok === 1 ? "ok" : "failed"}</p>
      <p>R2 binding: {env.MEDIA ? "ok" : "missing"}</p>
      <p>Instance: {configured ? "configured" : "not set up yet"}</p>
      <h2>Your invite link</h2>
      <p className="hint">
        {member.role === "admin"
          ? "Anyone with this link can join. It never runs out."
          : `The first ${settings.inviteQuota} people who join with this link are approved straight away. Later ones wait for the admin.`}
      </p>
      <CopyLink url={inviteUrl(origin, invite.code)} />
      <form action={signOutAction}>
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </main>
  );
}
