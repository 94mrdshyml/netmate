import { getInstanceState } from "@/instance/request";

export const dynamic = "force-dynamic";

export const metadata = { title: "Waiting for approval" };

export default async function WaitingPage() {
  const { settings } = await getInstanceState();
  return (
    <main className="column stack">
      <div>
        <h1>Waiting for approval</h1>
        <p>
          Your account is made. The admin of {settings.name} needs to approve it before you can sign in. Try signing in
          again later.
        </p>
      </div>
      <a href="/sign-in">Go to sign in</a>
    </main>
  );
}
