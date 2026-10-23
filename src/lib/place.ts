// The place on a post (docs/PRD.md section 8.2): plain text such as "Berlin, Germany", never
// coordinates. Pure, so the rules are tested without a database or a page.

export const PLACE_MAX = 60;

// Control characters other than whitespace never belong in a place name.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type PlaceCheck = { ok: true; place: string | null } | { ok: false; reason: "too_long" | "bad_characters" };

/** Cleans what was typed or chosen: spaces trimmed and squeezed, 1 to 60 characters. Empty means no place. */
export function checkPlace(raw: unknown): PlaceCheck {
  if (raw === undefined || raw === null) return { ok: true, place: null };
  if (typeof raw !== "string") return { ok: false, reason: "bad_characters" };
  if (CONTROL.test(raw)) return { ok: false, reason: "bad_characters" };
  const place = raw.replace(/\s+/g, " ").trim();
  if (place === "") return { ok: true, place: null };
  if (Array.from(place).length > PLACE_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, place };
}
