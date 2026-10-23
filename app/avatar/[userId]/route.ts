import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { defaultAvatarSvg } from "@/avatars/default";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { readInstanceCached } from "@/instance/settings";
import { isId } from "@/lib/ids";

// A member's default picture, drawn here so no reader's browser contacts anyone else. Members
// with an uploaded picture are shown from /media instead; this route is their fallback.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!isId("user", userId)) return new Response("Not found", { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const profile = await db
    .select({ username: profiles.username, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.status, "active")))
    .get();
  if (!profile) return new Response("Not found", { status: 404 });

  const { settings } = await readInstanceCached(db);
  const svg = defaultAvatarSvg(settings.avatarStyle, { username: profile.username, name: `${profile.firstName} ${profile.lastName}` });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Short, so a style change in the admin panel or a name change shows up soon.
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
