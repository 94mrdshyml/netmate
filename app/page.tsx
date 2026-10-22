import { getCloudflareContext } from "@opennextjs/cloudflare";

// Spike 1 check: a server component can reach the D1 and R2 bindings.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { env } = await getCloudflareContext({ async: true });
  const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1>Netmate</h1>
      <p>D1 binding: {row?.ok === 1 ? "ok" : "failed"}</p>
      <p>R2 binding: {env.MEDIA ? "ok" : "missing"}</p>
    </main>
  );
}
