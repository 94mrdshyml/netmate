import { describe, expect, it } from "vitest";
import { welcomeLine } from "@/lib/welcome-line";

describe("welcomeLine", () => {
  it("speaks of one person in the singular", () => {
    expect(welcomeLine(["Maria"], 0)).toBe("Maria is already here, saving you a seat.");
  });

  it("joins two and three names with commas and 'and'", () => {
    expect(welcomeLine(["Maria", "Sam"], 0)).toBe("Maria and Sam are already here, saving you a seat.");
    expect(welcomeLine(["Maria", "Sam", "Ines"], 0)).toBe("Maria, Sam and Ines are already here, saving you a seat.");
  });

  it("counts everyone else as others, and one as 'other'", () => {
    expect(welcomeLine(["Maria", "Sam", "Ines"], 12)).toBe("Maria, Sam, Ines and 12 others are already here, saving you a seat.");
    expect(welcomeLine(["Maria", "Sam"], 1)).toBe("Maria, Sam and 1 other are already here, saving you a seat.");
    expect(welcomeLine(["Maria"], 4)).toBe("Maria and 4 others are already here, saving you a seat.");
  });

  it("says nothing when there is nobody to name", () => {
    expect(welcomeLine([], 0)).toBe("");
  });

  it("uses no em dash and no emoji", () => {
    const line = welcomeLine(["Maria", "Sam", "Ines"], 12);
    expect(line).not.toContain("—");
    expect(line).toMatch(/^[\x20-\x7e]+$/);
  });

  it("passes names through untouched, leaving escaping to the page", () => {
    expect(welcomeLine(["<b>"], 0)).toContain("<b>");
  });
});
