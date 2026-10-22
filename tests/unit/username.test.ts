import { describe, expect, it } from "vitest";
import { reservedFromInstanceName, validateUsername } from "@/lib/username";

describe("validateUsername", () => {
  it("accepts letters, numbers and underscores and lower-cases them", () => {
    expect(validateUsername("Riya_99")).toEqual({ ok: true, username: "riya_99" });
  });

  it("trims surrounding whitespace", () => {
    expect(validateUsername("  meera  ")).toEqual({ ok: true, username: "meera" });
  });

  it("enforces 3 to 15 characters", () => {
    expect(validateUsername("ab")).toEqual({ ok: false, reason: "length" });
    expect(validateUsername("abc")).toEqual({ ok: true, username: "abc" });
    expect(validateUsername("a".repeat(15))).toEqual({ ok: true, username: "a".repeat(15) });
    expect(validateUsername("a".repeat(16))).toEqual({ ok: false, reason: "length" });
  });

  it("rejects other characters", () => {
    for (const bad of ["riya-dev", "riya.dev", "riya dev", "rïya", "@riya"]) {
      expect(validateUsername(bad)).toEqual({ ok: false, reason: "characters" });
    }
  });

  it("rejects reserved names in any case", () => {
    expect(validateUsername("Admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateUsername("hq")).toEqual({ ok: false, reason: "length" });
    expect(validateUsername("setup")).toEqual({ ok: false, reason: "reserved" });
    expect(validateUsername("waiting")).toEqual({ ok: false, reason: "reserved" });
  });

  it("reserves the instance name, letters and numbers only", () => {
    expect(reservedFromInstanceName("Green Valley School!")).toBe("greenvalleyschool");
    expect(validateUsername("greenvalley", { instanceName: "Green Valley" })).toEqual({
      ok: false,
      reason: "reserved",
    });
    expect(validateUsername("greenvalley")).toEqual({ ok: true, username: "greenvalley" });
  });
});
