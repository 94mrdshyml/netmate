import { describe, expect, it } from "vitest";
import { alertSentence, GROUPED_TYPES, SNIPPET_MAX, snippet, whoPhrase } from "@/lib/alert-text";

describe("whoPhrase", () => {
  it("names one, two, or one plus a count", () => {
    expect(whoPhrase(["Meera"], 1)).toBe("Meera");
    expect(whoPhrase(["Meera", "Sam"], 2)).toBe("Meera and Sam");
    expect(whoPhrase(["Meera", "Sam", "Ali"], 3)).toBe("Meera and 2 others");
    expect(whoPhrase(["Meera", "Sam", "Ali"], 12)).toBe("Meera and 11 others");
  });

  it("does not break with no names", () => {
    expect(whoPhrase([], 0)).toBe("Someone");
    expect(whoPhrase(["Meera"], 2)).toBe("Meera and 1 other");
  });
});

describe("alertSentence", () => {
  it("says what happened for every kind", () => {
    expect(alertSentence("like", ["Meera", "Sam", "Ali"], 3)).toBe("Meera and 2 others liked your post");
    expect(alertSentence("follow", ["Meera"], 1)).toBe("Meera followed you");
    expect(alertSentence("reply", ["Meera"], 1)).toBe("Meera replied to your post");
    expect(alertSentence("invite_used", ["Meera"], 1)).toBe("Meera joined with your invite link");
    expect(alertSentence("pending_approval", ["Meera"], 1)).toBe("Meera is waiting for your approval");
    expect(alertSentence("mention", ["Meera"], 1)).toBe("Meera mentioned you");
    expect(alertSentence("quote", ["Meera"], 1)).toBe("Meera quoted your post");
    expect(alertSentence("repost", ["Meera"], 1)).toBe("Meera reposted your post");
    expect(alertSentence("follow_request", ["Meera"], 1)).toBe("Meera asked to follow you");
  });

  it("uses no emoji and no em dashes", () => {
    for (const type of ["like", "follow", "reply", "invite_used", "pending_approval", "mention", "quote", "repost", "follow_request"] as const) {
      expect(alertSentence(type, ["Meera"], 1)).not.toMatch(/[—\p{Extended_Pictographic}]/u);
    }
  });
});

describe("snippet", () => {
  it("keeps short text and puts it on one line", () => {
    expect(snippet("hello\n\n  world ")).toBe("hello world");
  });

  it("cuts at 140 characters", () => {
    const long = "word ".repeat(100);
    const cut = snippet(long);
    expect(Array.from(cut).length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(cut.endsWith("...")).toBe(true);
    expect(snippet("x".repeat(SNIPPET_MAX))).toBe("x".repeat(SNIPPET_MAX));
  });

  it("counts letters, not bytes, so other scripts are not cut early", () => {
    const text = "あ".repeat(SNIPPET_MAX);
    expect(snippet(text)).toBe(text);
  });
});

describe("grouping", () => {
  it("collapses likes and reposts only", () => {
    expect(GROUPED_TYPES.has("like")).toBe(true);
    expect(GROUPED_TYPES.has("repost")).toBe(true);
    expect(GROUPED_TYPES.has("follow")).toBe(false);
    expect(GROUPED_TYPES.has("reply")).toBe(false);
  });
});
