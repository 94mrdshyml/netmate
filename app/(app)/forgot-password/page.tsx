import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { isEmailSetUp } from "@/server/email";
import { BrandMark } from "../_components/brand-mark";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  if (await getMember()) redirect("/");
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await getInstanceState();
  const emailReady = await isEmailSetUp(getDb(env.DB));

  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      <div>
        <h1>Forgot your password?</h1>
        <p className="muted">
          {emailReady
            ? "Enter your email and we will send you a link to choose a new one."
            : `Password reset is not available because ${settings.name} has not set up email. Ask the person who runs it for help.`}
        </p>
      </div>
      {emailReady ? <ForgotForm /> : null}
      <Link href="/sign-in">Back to sign in</Link>
    </main>
  );
}
