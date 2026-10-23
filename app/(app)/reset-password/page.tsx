import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { resetTokenIsLive } from "@/server/password-reset";
import { BrandMark } from "../_components/brand-mark";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

// The address carries a one-time token, so it is never passed on to another site in a Referer header.
export const metadata = { title: "Choose a new password", referrer: "no-referrer" } as const;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const live = await resetTokenIsLive(getDb(env.DB), token);

  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      {live && token ? (
        <>
          <div>
            <h1>Choose a new password</h1>
            <p className="muted">You will be asked to sign in again with it.</p>
          </div>
          <ResetForm token={token} />
        </>
      ) : (
        <>
          <div>
            <h1>Link not valid</h1>
            <p className="muted">This reset link is wrong, has already been used or has run out. Ask for a new one.</p>
          </div>
          <Link className="btn btn-primary btn-block" href="/forgot-password">
            Ask for a new link
          </Link>
        </>
      )}
      <Link href="/sign-in">Back to sign in</Link>
    </main>
  );
}
