import { describe, expect, it } from "vitest";
import { ID_LENGTH, ID_PREFIXES, isId, isIdModel, newId, randomId } from "@/lib/ids";

describe("ids", () => {
  it("looks like a Stripe id: prefix, underscore, 24 base62 characters", () => {
    expect(newId("user")).toMatch(/^usr_[0-9A-Za-z]{24}$/);
    expect(newId("session")).toMatch(/^sess_[0-9A-Za-z]{24}$/);
    expect(newId("account")).toMatch(/^acc_[0-9A-Za-z]{24}$/);
    expect(newId("verification")).toMatch(/^ver_[0-9A-Za-z]{24}$/);
  });

  it("never uses underscore or hyphen in the random part", () => {
    for (let i = 0; i < 500; i++) {
      expect(randomId()).not.toMatch(/[_-]/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(newId("user"));
    expect(seen.size).toBe(20_000);
  });

  it("uses every character of the alphabet, roughly evenly", () => {
    const counts = new Map<string, number>();
    const total = 62 * 2000;
    for (const ch of randomId(total)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(62);
    for (const n of counts.values()) {
      // Expected 2000 each; allow a wide band so the test is not flaky.
      expect(n).toBeGreaterThan(1700);
      expect(n).toBeLessThan(2300);
    }
  });

  it("honours a custom length", () => {
    expect(randomId(10)).toHaveLength(10);
    expect(randomId()).toHaveLength(ID_LENGTH);
  });

  it("has a unique prefix per model", () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("validates ids against their own model only", () => {
    const id = newId("user");
    expect(isId("user", id)).toBe(true);
    expect(isId("session", id)).toBe(false);
    expect(isId("user", "usr_short")).toBe(false);
    expect(isId("user", 42)).toBe(false);
  });

  it("knows which models have a prefix", () => {
    expect(isIdModel("user")).toBe(true);
    expect(isIdModel("organization")).toBe(false);
    expect(isIdModel("toString")).toBe(false);
  });
});
