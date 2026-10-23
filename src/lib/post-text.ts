// Rules for the text of a post (docs/PRD.md section 8.2). Characters are counted as the
// person sees them: one emoji is one character, not several.

export const POST_MAX = 280;

export type PostTextResult =
  | { ok: true; text: string; length: number }
  | { ok: false; reason: "empty" | "too_long" | "bad_characters" };

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Characters as a person counts them. */
export function countCharacters(text: string): number {
  if (segmenter) {
    return Array.from(segmenter.segment(text)).length;
  }
  return Array.from(text).length;
}

// Control characters other than newline and tab never belong in a post.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function checkPostText(raw: unknown): PostTextResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (CONTROL.test(text)) return { ok: false, reason: "bad_characters" };
  // The database counts code points (its limit is the same 280), so check both views.
  const length = countCharacters(text);
  if (length > POST_MAX || Array.from(text).length > POST_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text, length };
}
