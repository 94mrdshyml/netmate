// Small pure helpers for the staff list of cases: the page cursor and the search pattern.

/** The cursor is the case number of the last case on the page; the next page is every lower number. */
export function decodeCaseCursor(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** "%text%" for a LIKE with `escape '\'`: lower case, and the characters LIKE treats as wildcards taken literally. */
export function likePatternOf(raw: string): string {
  const text = Array.from(raw.trim().toLowerCase()).slice(0, 50).join("");
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
