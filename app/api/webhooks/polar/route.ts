import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db";
import { processPolarWebhook, WEBHOOK_MAX_BODY } from "@/server/polar-webhook";

// Polar's messages about subscriptions and payments (docs/PRD.md, "Paid subscriptions"). No session and no cookies:
// the signature is the only proof. See src/server/polar-webhook.ts.
const reply = (status: number, body: Record<string, unknown> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > WEBHOOK_MAX_BODY) return reply(413);
  const body = await request.text();
  const { env } = await getCloudflareContext({ async: true });
  const result = await processPolarWebhook(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, body, request.headers);
  return reply(result.status, result.body);
}
