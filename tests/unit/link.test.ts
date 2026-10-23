import { describe, expect, it } from "vitest";
import { displayLink, normalizeLink } from "@/lib/link";

describe("normalizeLink", () => {
  it("adds https:// when there is no scheme", () => {
    expect(normalizeLink("riya.dev")).toEqual({ ok: true, url: "https://riya.dev/" });
    expect(normalizeLink("  example.com/about  ")).toEqual({ ok: true, url: "https://example.com/about" });
  });

  it("keeps http and https as typed", () => {
    expect(normalizeLink("http://example.com")).toMatchObject({ ok: true, url: "http://example.com/" });
    expect(normalizeLink("https://sub.example.co.uk/x?y=1")).toMatchObject({ ok: true });
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["ftp://example.com"],
    ["mailto:a@b.co"],
    ["https://user:pass@example.com"],
    ["https://user@example.com"],
    ["localhost"],
    ["https://localhost"],
    ["http://127.0.0.1"],
    ["http://192.168.0.1"],
    ["not a link"],
    ["https://exa mple.com"],
    ["https://-bad-.com"],
    ["https://example.c"],
    ["https://example.123"],
    [""],
  ])("refuses %j", (value) => {
    expect(normalizeLink(value)).toMatchObject({ ok: false });
  });

  it("refuses more than 100 characters as typed", () => {
    expect(normalizeLink(`example.com/${"a".repeat(100)}`)).toEqual({ ok: false, reason: "too_long" });
    expect(normalizeLink(`example.com/${"a".repeat(87)}`).ok).toBe(true);
  });

  it("accepts international domains in their ASCII form", () => {
    expect(normalizeLink("münchen.de")).toMatchObject({ ok: true, url: "https://xn--mnchen-3ya.de/" });
  });
});

describe("displayLink", () => {
  it("drops the scheme and a lone trailing slash", () => {
    expect(displayLink("https://riya.dev/")).toBe("riya.dev");
    expect(displayLink("http://example.com/about")).toBe("example.com/about");
  });
});
