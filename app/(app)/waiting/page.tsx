import Link from "next/link";
import { BrandMark } from "../_components/brand-mark";
import { getInstanceState } from "@/instance/request";

export const dynamic = "force-dynamic";

export const metadata = { title: "Waiting for approval" };

export default async function WaitingPage() {
  const { settings } = await getInstanceState();
  return (
    <main className="column stack auth">
      <BrandMark name={settings.name} size="lg" />
      <div>
        <h1>Waiting for approval</h1>
        <p>
          Your account is made. The admin of {settings.name} needs to approve it before you can sign in. Try signing in
          again later.
        </p>
      </div>
      <Link href="/sign-in">Go to sign in</Link>
    </main>
  );
}
