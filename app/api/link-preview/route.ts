import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { linkFetcherFor } from "@/links/fetch";
import { signLinkCard } from "@/links/token";
import { normalizePostLink } from "@/lib/post-links";
import { limitLinkPreview, tooManyMessage } from "@/server/rate-limit";

// The card for a web address typed into the composer (docs/PRD.md section 8.2). A member must be signed
// in and the admin must have turned link previews on. Our server visits the page (never the member's
// phone, so that site sees our server and not who is writing), at most 20 times in 10 minutes per member.
// The answer carries a signed token; the post action saves a card only with that token, so a browser cannot
// make up a card. Nothing about the address is stored or logged.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // A form posted from another site must not spend this member's fetches.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ message: "Not allowed." }, 403);

  const member = await getMember();
  if (!member) return json({ message: "Sign in first." }, 401);

  // Read fresh, not from the settings cache: this route keeps a copy of its own, and a switch the admin
  // has just changed must take effect at once.
  const { env } = await getCloudflareContext({ async: true });
  const { settings } = await readInstance(getDb(env.DB));
  if (!settings.linkPreviewsEnabled) return json({ message: "Not found." }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ card: null });
  }
  const typed = typeof (body as { url?: unknown } | null)?.url === "string" ? (body as { url: string }).url : "";
  const address = normalizePostLink(typed.trim());
  // Not an address a post could link to: nothing is fetched and no slot is used.
  if (!address) return json({ card: null });

  const limited = await limitLinkPreview(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return json({ card: null, message: tooManyMessage(limited.retryAfterSeconds) }, 429);

  const found = await linkFetcherFor(env)(address);
  // A page with no card, or one that cannot be reached, is not an error for the member: the post just has no card.
  if (!found.ok) return json({ card: null });
  return json({ card: found.card, token: await signLinkCard(found.card, member.userId, env.AUTH_SECRET) });
}
