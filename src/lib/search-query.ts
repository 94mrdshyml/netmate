// Turns what a person typed into an FTS5 MATCH string (docs/PRD.md section 8.6). The user's text
// never reaches the index as syntax: every term is wrapped in double quotes (inside quotes FTS5
// only tokenises, so `-`, `*`, `:`, `(`, `NEAR` and the rest are plain words), and the only
// operator we add ourselves is the `*` on the last term, so results appear while typing.

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 100;
const MAX_TERMS = 8;
const MAX_TERM_CHARS = 50;

/** A term worth searching has at least one letter or number; "!!!" would match nothing and is dropped. */
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

export type SearchQuery = {
  /** The string to bind to `... MATCH ?`. */
  match: string;
  /** The terms in plain text, for showing back to the person and for ordering people. */
  terms: string[];
};

/** Splits on spaces; "quoted phrases" stay together. */
function tokenize(text: string): { text: string; phrase: boolean }[] {
  const tokens: { text: string; phrase: boolean }[] = [];
  const pattern = /"([^"]*)"|([^\s"]+)/g;
  for (const m of text.matchAll(pattern)) {
    const quoted = m[1];
    if (quoted !== undefined) tokens.push({ text: quoted, phrase: true });
    else if (m[2] !== undefined) tokens.push({ text: m[2], phrase: false });
  }
  return tokens;
}

/**
 * Builds the match string, or null when the query is too short or has nothing searchable in it.
 * A leading `@` (people) or `#` (tags) is ignored. Hashtag storage does not exist yet, so `#tag`
 * searches the word until the tags table does.
 */
export function buildSearchQuery(raw: unknown): SearchQuery | null {
  if (typeof raw !== "string") return null;
  // Control characters (NUL and friends) have no place in a query.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/^[@#]+/, "").slice(0, SEARCH_MAX_CHARS);
  if (Array.from(cleaned).length < SEARCH_MIN_CHARS) return null;

  const tokens = tokenize(cleaned)
    .map((t) => ({ ...t, text: t.text.trim().slice(0, MAX_TERM_CHARS) }))
    .filter((t) => HAS_WORD_CHARACTER.test(t.text))
    .slice(0, MAX_TERMS);
  if (tokens.length === 0) return null;

  const lastIndex = tokens.length - 1;
  const parts = tokens.map((t, i) => {
    const quoted = `"${t.text.replaceAll('"', '""')}"`;
    // The last word typed so far is a prefix ("mee" finds "Meera"); a finished phrase is exact.
    return i === lastIndex && !t.phrase ? `${quoted}*` : quoted;
  });
  return { match: parts.join(" "), terms: tokens.map((t) => t.text) };
}
