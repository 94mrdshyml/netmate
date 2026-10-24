// What a member can report a post for, and how a case is numbered. One list, read by the report form, the
// admin screens, the database check and the tests, so a category is added in one place (and in the
// CHECK of a new migration).

export const REPORT_CATEGORIES = [
  { id: "spam", label: "Spam", hint: "Ads, scams or the same thing posted again and again." },
  { id: "harassment", label: "Bullying or harassment", hint: "Targeting, insulting or pestering a person." },
  { id: "hate", label: "Hate", hint: "Attacking people for who they are." },
  { id: "threat", label: "Threats or violence", hint: "Hurting someone, or saying they will be hurt." },
  { id: "sexual", label: "Sexual content", hint: "Nudity or sexual material nobody asked to see." },
  { id: "self_harm", label: "Self-harm", hint: "Someone who may be in danger or hurting themselves." },
  { id: "misinformation", label: "False information", hint: "Something untrue that could mislead or harm people." },
  { id: "impersonation", label: "Pretending to be someone", hint: "Posing as another person or as the organisation." },
  { id: "private_info", label: "Private information", hint: "Someone's address, number or photos shared without consent." },
  { id: "illegal", label: "Something illegal", hint: "Content that breaks the law." },
  { id: "other", label: "Something else", hint: "Anything that does not fit above. Tell us what is wrong." },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export const REPORT_CATEGORY_IDS: readonly ReportCategory[] = REPORT_CATEGORIES.map((c) => c.id);

/** The note a reporter may add: up to this many characters. "Something else" needs one. */
export const REPORT_NOTE_MAX = 500;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORY_IDS as readonly string[]).includes(value);
}

export function categoryLabel(id: string): string {
  return REPORT_CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

// ---- case ids ----

/**
 * How a case ends. "Post removed" arrives with the removal tools (the database already allows it, so that
 * change needs no table rebuild); until then staff pick from these.
 */
export const REPORT_OUTCOMES = [
  { id: "no_action", label: "No action needed" },
  { id: "handled", label: "Handled" },
  { id: "duplicate", label: "Same as another case" },
] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number]["id"];

export const REPORT_OUTCOME_IDS: readonly ReportOutcome[] = REPORT_OUTCOMES.map((o) => o.id);

export function isReportOutcome(value: unknown): value is ReportOutcome {
  return typeof value === "string" && (REPORT_OUTCOME_IDS as readonly string[]).includes(value);
}

export function outcomeLabel(id: string | null): string {
  if (id === "removed") return "Post removed";
  return REPORT_OUTCOMES.find((o) => o.id === id)?.label ?? "Closed";
}

/** The number people read out and search for: CASE-000123. Six digits at least, more when it needs them. */
export function formatCaseId(caseNo: number): string {
  return `CASE-${String(Math.max(0, Math.trunc(caseNo))).padStart(6, "0")}`;
}

/** "CASE-000123", "case 123", "case-123" or just "123" back to 123; anything else is null. */
export function parseCaseId(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^\s*(?:case[\s-]*)?(\d{1,9})\s*$/i.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 ? n : null;
}

// ---- the notes ----

// Control characters other than newline and tab never belong in a note.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type ReportNoteResult = { ok: true; text: string } | { ok: false; reason: "required" | "too_long" | "bad_characters" };

/**
 * A note on a report, or staff's note on closing one. Trimmed, at most 500 characters (counted the way the
 * database counts them, as code points), no control characters. `required` makes an empty note an error.
 */
export function checkReportNote(raw: unknown, required = false): ReportNoteResult {
  const text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (text === "") return required ? { ok: false, reason: "required" } : { ok: true, text: "" };
  if (CONTROL.test(text)) return { ok: false, reason: "bad_characters" };
  if (Array.from(text).length > REPORT_NOTE_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}
