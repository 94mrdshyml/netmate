import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { isEmailSetUp } from "@/server/email";
import { BrandMark } from "../_components/brand-mark";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getMember()) redirect("/");
  const { reset } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  // "Forgot password" only appears when there is email to send the link with.
  const canReset = await isEmailSetUp(getDb(env.DB));

  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      <div>
        <h1>Sign in</h1>
        <p className="muted">Welcome back to {settings.name}.</p>
      </div>
      {reset === "1" ? (
        <p className="banner" role="status">
          Your password was changed. Sign in with the new one.
        </p>
      ) : null}
      <SignInForm />
      {canReset ? <Link href="/forgot-password">Forgot your password?</Link> : null}
      <p className="hint">New here? You need an invite link from a member to join.</p>
    </main>
  );
}
