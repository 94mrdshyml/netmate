import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { inviteWelcome } from "@/server/invite-welcome";
import { findActiveInvite } from "@/server/invites";
import { BrandMark } from "../_components/brand-mark";
import { InviteWelcomeScreen } from "./invite-welcome";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ invite?: string; join?: string }> }) {
  if (await getMember()) redirect("/");

  const { invite: code, join } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const invite = await findActiveInvite(getDb(env.DB), code);
  const { settings } = await getInstanceState();

  if (!invite || !code) {
    return (
      <main className="column stack auth">
        <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
        <div>
          <h1>Invite link not valid</h1>
          <p className="muted">
            {settings.name} is invite only. This link is wrong or has been turned off. Ask the person who sent it for a new one.
          </p>
        </div>
        <Link href="/sign-in">Already a member? Sign in</Link>
      </main>
    );
  }

  // A valid link first opens the welcome screen; its button comes back here with join=1 for the form.
  if (join !== "1") {
    return (
      <InviteWelcomeScreen
        settings={settings}
        inviterName={invite.ownerName}
        welcome={await inviteWelcome(getDb(env.DB), invite)}
        joinHref={`/sign-up?invite=${encodeURIComponent(code)}&join=1`}
      />
    );
  }

  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      <div>
        <h1>Join {settings.name}</h1>
        <p className="muted">{invite.ownerName} invited you.</p>
      </div>
      <SignUpForm invite={code} />
      <Link href="/sign-in">Already a member? Sign in</Link>
    </main>
  );
}
