import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaKindOf } from "@/storage/keys";

// Serves stored pictures. Names are random and never reused, so a picture can be cached for ever.
// Pictures, the instance logo and favicon, and hosted fonts are served, each only as the type
// it was stored with, and never as a page.
const SERVED = new Set(["avatar", "banner", "post", "instance", "font"]);
const ALLOWED_TYPES: Record<string, Set<string>> = {
  avatar: new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  banner: new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  post: new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  instance: new Set(["image/png", "image/svg+xml"]),
  font: new Set(["font/woff2"]),
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");

  const kind = mediaKindOf(key);
  if (!kind || !SERVED.has(kind) || key.includes("..")) return new Response("Not found", { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.MEDIA.get(key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !type || !ALLOWED_TYPES[kind]?.has(type)) return new Response("Not found", { status: 404 });

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
