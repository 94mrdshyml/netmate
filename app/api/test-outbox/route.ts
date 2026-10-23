import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readOutbox } from "@/email/transport";

// For the end-to-end tests only: what the fake mail transport "sent" to one address. It answers
// only when the Worker runs with ENV=test (the preview the tests start); everywhere else, including
// production, it is a plain 404 and reads nothing.
export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const to = new URL(request.url).searchParams.get("to") ?? "";
  const items = readOutbox(env, to);
  if (!items) return new Response("Not found", { status: 404 });
  return Response.json({ items: items.map((i) => ({ to: i.to, subject: i.subject, text: i.text, at: i.at })) });
}
