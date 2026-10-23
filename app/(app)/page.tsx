import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getInstanceState } from "@/instance/request";
import { signOutAction } from "./sign-in/actions";

// Spike 1 check: a server component can reach the D1 and R2 bindings.
export const dynamic = "force-dynamic";

export default async function Home() {
  const member = await getMember();
  if (!member) redirect("/sign-in");

  const { env } = await getCloudflareContext({ async: true });
  const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  const { settings, configured } = await getInstanceState();

  return (
    <main className="column">
      <h1>{settings.name}</h1>
      <p>Signed in as @{member.username}</p>
      <p>D1 binding: {row?.ok === 1 ? "ok" : "failed"}</p>
      <p>R2 binding: {env.MEDIA ? "ok" : "missing"}</p>
      <p>Instance: {configured ? "configured" : "not set up yet"}</p>
      <form action={signOutAction}>
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </main>
  );
}
