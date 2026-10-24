import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { existingMentions, suggestMentions } from "@/server/mentions";
import { limitMentions, tooManyMessage } from "@/server/rate-limit";

// Names for the post composer (docs/PRD.md section 8.2). `?q=ab` suggests people whose name starts
// with "ab" (an empty q suggests people you follow); `?names=a,b` says which typed names are real
// people. A member must be signed in, and each person gets 120 lookups a minute. Nothing typed is
// stored or logged.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  // Another site must not spend this member's lookups.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return json({ message: "Not allowed." }, 403);

  const member = await getMember();
  if (!member) return json({ message: "Sign in first." }, 401);

  const params = new URL(request.url).searchParams;
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitMentions(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return json({ message: tooManyMessage(limited.retryAfterSeconds) }, 429);

  const db = getDb(env.DB);
  const names = params.get("names");
  if (names !== null) return json({ names: await existingMentions(db, member.userId, names.split(",").slice(0, 10)) });
  return json({ people: await suggestMentions(db, member.userId, params.get("q") ?? "") });
}
