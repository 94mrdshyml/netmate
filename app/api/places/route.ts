import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { QUERY_MIN, searcherFor } from "@/places/photon";
import { limitPlaces, tooManyMessage } from "@/server/rate-limit";

// Place suggestions for the post composer (docs/PRD.md sections 8.2 and 8.4). A member must be
// signed in, the admin must have turned place suggestions on, and each person gets 40 lookups a
// minute. Our server asks Photon; the member's phone never does. Nothing typed is stored or logged.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  // Another site must not spend this member's lookups.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return json({ message: "Not allowed." }, 403);

  const member = await getMember();
  if (!member) return json({ message: "Sign in first." }, 401);

  // Read fresh, not from the settings cache: this route keeps a copy of its own, and a switch the admin
  // has just changed must take effect at once.
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await readInstance(getDb(env.DB));
  if (!settings.placesEnabled) return json({ message: "Not found." }, 404);

  const query = (new URL(request.url).searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  // Too short to be worth a lookup: nothing is asked of Photon and no slot is used.
  if (Array.from(query).length < QUERY_MIN) return json({ places: [] });

  const limited = await limitPlaces(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return json({ message: tooManyMessage(limited.retryAfterSeconds) }, 429);

  const found = await searcherFor(env)(query);
  // Photon being down is not an error for the member: they can still type the place themselves.
  return json(found.ok ? { places: found.places } : { places: [], unavailable: true });
}
