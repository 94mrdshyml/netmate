// Where files live in the R2 bucket (docs/PRD.md section 12). R2 has no real folders, so each
// kind of file gets its own key prefix. Every upload builds its key here, nowhere else.

import { randomId } from "@/lib/ids";

export const MEDIA_PREFIXES = {
  /** Profile pictures. */
  avatar: "avatars",
  /** Profile cover images. */
  banner: "banners",
  /** Pictures attached to posts. */
  post: "posts",
  /** Instance logo and favicon. */
  instance: "instance",
  /** Self-hosted fonts. */
  font: "fonts",
} as const;

export type MediaKind = keyof typeof MEDIA_PREFIXES;

export const IMAGE_EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/**
 * A new storage key: `<prefix>/<owner id>/<random>.<ext>`. The owner is the member for avatars
 * and banners, the post for post pictures. A fresh random name each time means a replaced
 * picture never serves from a stale cache.
 */
export function newMediaKey(kind: Exclude<MediaKind, "instance" | "font">, ownerId: string, ext: ImageExtension): string {
  return `${MEDIA_PREFIXES[kind]}/${ownerId}/${randomId(24)}.${ext}`;
}

/** Which kind of file a stored key belongs to, or null if it is not one of ours. */
export function mediaKindOf(key: string): MediaKind | null {
  const found = (Object.entries(MEDIA_PREFIXES) as [MediaKind, string][]).find(([, p]) => key.startsWith(`${p}/`) && key.length > p.length + 1);
  return found ? found[0] : null;
}
