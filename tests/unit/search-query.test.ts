import { describe, expect, it } from "vitest";
import { buildSearchQuery, SEARCH_MAX_CHARS } from "@/lib/search-query";

describe("buildSearchQuery", () => {
  it("quotes every term and makes the last one a prefix", () => {
    expect(buildSearchQuery("hello wor")?.match).toBe('"hello" "wor"*');
    expect(buildSearchQuery("meera")?.match).toBe('"meera"*');
  });

  it("keeps a quoted phrase together and exact", () => {
    expect(buildSearchQuery('"good morning" tea')?.match).toBe('"good morning" "tea"*');
    expect(buildSearchQuery('tea "good morning"')?.match).toBe('"tea" "good morning"');
  });

  it("ignores a leading @ or #", () => {
    expect(buildSearchQuery("@meera")?.match).toBe('"meera"*');
    expect(buildSearchQuery("#coffee")?.match).toBe('"coffee"*');
  });

  it("needs at least two characters", () => {
    expect(buildSearchQuery("")).toBeNull();
    expect(buildSearchQuery(" a ")).toBeNull();
    expect(buildSearchQuery("@a")).toBeNull();
    expect(buildSearchQuery("ab")).not.toBeNull();
    expect(buildSearchQuery("你好")).not.toBeNull();
  });

  it("returns null for things that are not text or have nothing to search", () => {
    expect(buildSearchQuery(undefined)).toBeNull();
    expect(buildSearchQuery(42)).toBeNull();
    expect(buildSearchQuery("!!! ???")).toBeNull();
    expect(buildSearchQuery('""')).toBeNull();
  });

  it("never lets search syntax through", () => {
    // Every term sits inside double quotes, with any quote inside doubled; the only bare operator is the final star.
    for (const attack of ["a OR b", "NEAR(a b)", "body:secret", "a* -b", "^a", "(a", 'a"b', "a AND NOT b", "\u0000x\u0000y"]) {
      const q = buildSearchQuery(attack);
      expect(q).not.toBeNull();
      const withoutQuoted = (q as { match: string }).match.replace(/"(?:[^"]|"")*"/g, "");
      expect(withoutQuoted.replace(/\*/g, "").trim()).toBe("");
      expect(withoutQuoted.match(/\*/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the words and drops control characters", () => {
    expect(buildSearchQuery("a\u0000b cd")?.terms).toEqual(["a", "b", "cd"]);
  });

  it("caps the number and size of terms and the whole query", () => {
    const many = buildSearchQuery(Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "));
    expect(many?.terms).toHaveLength(8);
    expect(buildSearchQuery("x".repeat(500))?.terms[0]).toHaveLength(50);
    expect(SEARCH_MAX_CHARS).toBe(100);
  });
});
