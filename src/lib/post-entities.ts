// Hashtags and mentions in the text of a post (docs/PRD.md section 8.2). They are found by parsing
// the text, never by putting markup into it: a post is always shown as text, and the parts that are
// tags or mentions are drawn as links by the page. Pure, so the rules are tested without a database.

export const TAG_MAX = 50;
export const TAGS_PER_POST = 10;
export const MENTIONS_PER_POST = 10;

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tag"; text: string; tag: string }
  | { kind: "mention"; text: string; username: string };

const WORD = /[\p{L}\p{N}_]/u;
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
// The same shape a username is allowed to have (src/lib/username.ts), so "@ab" or "@a.b" is not a mention.
const USERNAME_SHAPE = /^[a-z0-9_]{3,15}$/i;
// A web address is left alone: its "#section" or "@" is not a tag or a mention.
const WEB_ADDRESS = /^(https?:\/\/|www\.)/i;

/** The run of letters, numbers and underscores that starts at `from`. */
function runFrom(token: string, from: number): string {
  let end = from;
  while (end < token.length) {
    const ch = String.fromCodePoint(token.codePointAt(end)!);
    if (!WORD.test(ch)) break;
    end += ch.length;
  }
  return token.slice(from, end);
}

/**
 * Splits post text into plain text, `#tags` and `@mentions`, in order, so that joining every
 * segment's `text` gives the original back. A `#` or `@` counts only at the start of a word (so
 * "me@example.com" and "C#" are plain), a tag is 1 to 50 letters, numbers or underscores with at
 * least one letter or number, and a mention has the shape of a username.
 */
export function parsePostText(text: string): Segment[] {
  const out: Segment[] = [];
  const push = (segment: Segment) => {
    const last = out[out.length - 1];
    if (segment.kind === "text" && last?.kind === "text") last.text += segment.text;
    else out.push(segment);
  };

  for (const token of text.split(/(\s+)/)) {
    if (token === "" ) continue;
    if (/^\s+$/.test(token) || WEB_ADDRESS.test(token)) {
      push({ kind: "text", text: token });
      continue;
    }
    let plainFrom = 0;
    let i = 0;
    while (i < token.length) {
      const ch = token[i];
      const before = i === 0 ? "" : token[i - 1]!;
      const startsWord = i === 0 || !(WORD.test(before) || before === "#" || before === "@");
      if ((ch === "#" || ch === "@") && startsWord) {
        const run = runFrom(token, i + 1);
        const isTag = ch === "#" && run.length > 0 && Array.from(run).length <= TAG_MAX && HAS_LETTER_OR_NUMBER.test(run);
        const isMention = ch === "@" && USERNAME_SHAPE.test(run);
        if (isTag || isMention) {
          if (i > plainFrom) push({ kind: "text", text: token.slice(plainFrom, i) });
          const raw = token.slice(i, i + 1 + run.length);
          push(isTag ? { kind: "tag", text: raw, tag: run.toLowerCase() } : { kind: "mention", text: raw, username: run.toLowerCase() });
          i += 1 + run.length;
          plainFrom = i;
          continue;
        }
      }
      i += 1;
    }
    if (plainFrom < token.length) push({ kind: "text", text: token.slice(plainFrom) });
  }
  return out;
}

/** The distinct tags (lower-cased) and mentioned usernames of a post, in order, at most 10 of each. Extra ones stay plain text. */
export function extractEntities(text: string): { tags: string[]; mentions: string[] } {
  const tags: string[] = [];
  const mentions: string[] = [];
  for (const segment of parsePostText(text)) {
    if (segment.kind === "tag" && !tags.includes(segment.tag) && tags.length < TAGS_PER_POST) tags.push(segment.tag);
    if (segment.kind === "mention" && !mentions.includes(segment.username) && mentions.length < MENTIONS_PER_POST) mentions.push(segment.username);
  }
  return { tags, mentions };
}

/** "#Coffee" typed alone in the search box is a tag search. Anything else is an ordinary search. */
export function parseTagQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^#([\p{L}\p{N}_]+)$/u.exec(raw.trim());
  const tag = match?.[1];
  if (!tag || Array.from(tag).length > TAG_MAX || !HAS_LETTER_OR_NUMBER.test(tag)) return null;
  return tag.toLowerCase();
}

/**
 * The `@name` being typed right at the cursor, for the suggestion list: where its `@` is, and what has
 * been typed after it (letters, numbers and underscores only, up to the length of a username). Null
 * when the cursor is not at the end of one: the `@` must start a word (so "me@" is not one), not be
 * inside a web address, and nothing but name characters may sit between it and the cursor.
 */
export function mentionAtCaret(text: string, caret: number): { start: number; prefix: string } | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const chunk = before.slice(Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t")) + 1);
  if (WEB_ADDRESS.test(chunk)) return null;
  const match = /@([A-Za-z0-9_]{0,15})$/.exec(chunk);
  if (!match) return null;
  const at = chunk.length - match[0].length;
  const prev = at === 0 ? "" : chunk[at - 1]!;
  if (prev !== "" && (WORD.test(prev) || prev === "#" || prev === "@")) return null;
  return { start: before.length - match[0].length, prefix: match[1]!.toLowerCase() };
}
