import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getInstanceState } from "@/instance/request";
import { BrandMark } from "../_components/brand-mark";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getMember()) redirect("/");
  const { settings } = await getInstanceState();

  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      <div>
        <h1>Sign in</h1>
        <p className="muted">Welcome back to {settings.name}.</p>
      </div>
      <SignInForm />
      <p className="hint">New here? You need an invite link from a member to join.</p>
    </main>
  );
}
