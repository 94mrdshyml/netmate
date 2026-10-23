import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaKindOf } from "@/storage/keys";

// Serves stored pictures. Names are random and never reused, so a picture can be cached for ever.
// Only the three picture prefixes are served, only image types, and never as a page.
const SERVED = new Set(["avatar", "banner", "post"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");

  const kind = mediaKindOf(key);
  if (!kind || !SERVED.has(kind) || key.includes("..")) return new Response("Not found", { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA.get(key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !type || !IMAGE_TYPES.has(type)) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: object.httpEtag,
    },
  });
}
