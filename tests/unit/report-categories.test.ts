import { describe, expect, it } from "vitest";
import { decodeCaseCursor, likePatternOf } from "@/lib/report-list";
import {
  categoryLabel,
  checkReportNote,
  formatCaseId,
  isReportCategory,
  isReportOutcome,
  outcomeLabel,
  parseCaseId,
  REPORT_CATEGORIES,
  REPORT_NOTE_MAX,
} from "@/lib/report-categories";
import { validateUsername } from "@/lib/username";

describe("report categories", () => {
  it("has unique ids, a label and a hint for each, and 'other' last", () => {
    const ids = REPORT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[ids.length - 1]).toBe("other");
    for (const c of REPORT_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.hint.length).toBeGreaterThan(5);
      // Plain interface text: no em dashes, no emoji.
      expect(`${c.label} ${c.hint}`).not.toMatch(/—|\p{Extended_Pictographic}/u);
    }
  });

  it("matches the list the database allows", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("migrations/0017_reports.sql", "utf8");
    const allowed = /"reports_category" CHECK\([^)]*in \(([^)]*)\)/.exec(sql)?.[1]?.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    expect([...allowed].sort()).toEqual(REPORT_CATEGORIES.map((c) => c.id).sort());
  });

  it("knows a category when it sees one", () => {
    expect(isReportCategory("spam")).toBe(true);
    expect(isReportCategory("Spam")).toBe(false);
    expect(isReportCategory(null)).toBe(false);
    expect(categoryLabel("spam")).toBe("Spam");
    expect(categoryLabel("nonsense")).toBe("Other");
  });

  it("knows the outcomes staff may pick, and words 'removed' for later", () => {
    expect(isReportOutcome("handled")).toBe(true);
    expect(isReportOutcome("removed")).toBe(false);
    expect(outcomeLabel("removed")).toBe("Post removed");
    expect(outcomeLabel(null)).toBe("Closed");
  });
});

describe("case ids", () => {
  it("are written with at least six digits", () => {
    expect(formatCaseId(1)).toBe("CASE-000001");
    expect(formatCaseId(123)).toBe("CASE-000123");
    expect(formatCaseId(1234567)).toBe("CASE-1234567");
  });

  it("are read back in the ways people type them", () => {
    for (const text of ["CASE-000123", "case-000123", " Case 123 ", "123", "000123", "case123"]) expect(parseCaseId(text)).toBe(123);
    for (const text of ["", "case", "case-0", "0", "-5", "1.5", "12a", "CASE-1234567890", "post_abc", 7, null]) expect(parseCaseId(text)).toBeNull();
  });

  it("round trip", () => {
    for (const n of [1, 9, 10, 999999, 1000000]) expect(parseCaseId(formatCaseId(n))).toBe(n);
  });
});

describe("report notes", () => {
  it("are trimmed, optional by default and can be required", () => {
    expect(checkReportNote("  hello  ")).toEqual({ ok: true, text: "hello" });
    expect(checkReportNote(undefined)).toEqual({ ok: true, text: "" });
    expect(checkReportNote("   ", true)).toEqual({ ok: false, reason: "required" });
    expect(checkReportNote("a\r\nb")).toEqual({ ok: true, text: "a\nb" });
  });

  it("refuse control characters and anything over the limit", () => {
    expect(checkReportNote("bad\u0007text")).toEqual({ ok: false, reason: "bad_characters" });
    expect(checkReportNote("x".repeat(REPORT_NOTE_MAX))).toMatchObject({ ok: true });
    expect(checkReportNote("x".repeat(REPORT_NOTE_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
    // Counted as the database counts: one emoji is one code point here.
    expect(checkReportNote("\u{1F600}".repeat(REPORT_NOTE_MAX))).toMatchObject({ ok: true });
  });
});

describe("the case list helpers", () => {
  it("reads only a plain case number as a cursor", () => {
    expect(decodeCaseCursor("42")).toBe(42);
    for (const bad of ["0", "-1", "4x", "", "1".repeat(10), null, 5]) expect(decodeCaseCursor(bad)).toBeNull();
  });

  it("takes wildcards in a search literally", () => {
    expect(likePatternOf(" 50%_Off ")).toBe("%50\\%\\_off%");
  });

  it("keeps the new pages from being taken as usernames", () => {
    expect(validateUsername("report").ok).toBe(false);
    expect(validateUsername("reports").ok).toBe(false);
  });
});
