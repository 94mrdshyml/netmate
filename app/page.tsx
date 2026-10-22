import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getInstanceState } from "@/instance/request";

// Spike 1 check: a server component can reach the D1 and R2 bindings.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { env } = await getCloudflareContext({ async: true });
  const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  const { settings, configured } = await getInstanceState();

  return (
    <main className="column">
      <h1>{settings.name}</h1>
      <p>D1 binding: {row?.ok === 1 ? "ok" : "failed"}</p>
      <p>R2 binding: {env.MEDIA ? "ok" : "missing"}</p>
      <p>Instance: {configured ? "configured" : "not set up yet"}</p>
    </main>
  );
}
