import { describe, expect, it } from "vitest";
import { POST_MAX, checkPostText, countCharacters } from "@/lib/post-text";

describe("checkPostText", () => {
  it("accepts ordinary text and trims the edges", () => {
    expect(checkPostText("  hello world \n")).toEqual({ ok: true, text: "hello world", length: 11 });
  });

  it("keeps inner newlines and tabs, and turns Windows line ends into newlines", () => {
    expect(checkPostText("a\r\nb\tc")).toMatchObject({ ok: true, text: "a\nb\tc" });
  });

  it.each([["empty", ""], ["only spaces", "   \n\t "], ["not text", 42], ["missing", undefined]])("refuses %s", (_name, value) => {
    expect(checkPostText(value)).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly 280 characters and refuses 281", () => {
    expect(checkPostText("a".repeat(POST_MAX)).ok).toBe(true);
    expect(checkPostText("a".repeat(POST_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts an emoji as one character, as the person sees it", () => {
    expect(countCharacters("👍")).toBe(1);
    expect(countCharacters("👨‍👩‍👧‍👦")).toBe(1);
    expect(countCharacters("é")).toBe(1);
    expect(checkPostText("👍".repeat(280)).ok).toBe(true);
  });

  it("refuses control characters", () => {
    expect(checkPostText("hi\u0000there")).toEqual({ ok: false, reason: "bad_characters" });
    expect(checkPostText("hi\u001Bthere")).toEqual({ ok: false, reason: "bad_characters" });
  });

  it("keeps text that looks like markup as plain text", () => {
    expect(checkPostText("<script>alert(1)</script>")).toMatchObject({ ok: true, text: "<script>alert(1)</script>" });
  });
});
