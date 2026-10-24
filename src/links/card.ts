// The rules a link card must meet before it is saved (docs/PRD.md section 8.2). A card comes from our
// own fetcher through a signed token, but it is checked again here, and again by the database, so that
// nothing else can ever write one that is not plain text of the right size with safe addresses.

import { cardImage, cleanText, DESCRIPTION_MAX, IMAGE_MAX, SITE_MAX, TITLE_MAX } from "@/links/html";
import type { LinkCard } from "@/links/fetch";
import { normalizePostLink } from "@/lib/post-links";

const isText = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && Array.from(v).length >= min && Array.from(v).length <= max && cleanText(v, max) === v;

/** The card, if it is whole and safe: one-line plain text within the limits, an address a post may link to, and a picture that is https on a real domain. */
export function checkLinkCard(raw: unknown): LinkCard | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { url, title, description, image, site } = raw as Record<string, unknown>;
  if (typeof url !== "string" || normalizePostLink(url) !== url) return null;
  if (!isText(title, 1, TITLE_MAX) || !isText(description ?? "", 0, DESCRIPTION_MAX) || !isText(site, 1, SITE_MAX)) return null;
  let picture: string | null = null;
  if (image !== null && image !== undefined) {
    if (typeof image !== "string" || image.length > IMAGE_MAX) return null;
    picture = cardImage(image, new URL(url));
    if (picture !== image) return null;
  }
  return { url, title, description: (description as string | undefined) ?? "", image: picture, site };
}
