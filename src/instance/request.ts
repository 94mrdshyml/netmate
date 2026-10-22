import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";
import { readInstanceCached, type InstanceState } from "@/instance/settings";

/** The instance state for the current request. Only callable inside a request. */
export async function getInstanceState(): Promise<InstanceState> {
  const { env } = await getCloudflareContext({ async: true });
  return readInstanceCached(getDb(env.DB));
}
