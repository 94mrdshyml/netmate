import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { setupProblems } from "@/instance/setup";
import { SetupFlow } from "./setup-flow";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  const { env } = await getCloudflareContext({ async: true });
  // Read the database directly, not the cache: this page must vanish the moment setup is done.
  if ((await readInstance(getDb(env.DB))).configured) notFound();

  return (
    <main className="column">
      <SetupFlow problems={setupProblems(env)} />
    </main>
  );
}
