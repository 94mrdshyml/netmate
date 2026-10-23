import { describe, expect, it } from "vitest";
import { parseThemeChoice, themeAttribute } from "@/lib/theme-choice";

describe("parseThemeChoice", () => {
  it("accepts only the three known choices", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
    expect(parseThemeChoice("sepia")).toBeNull();
    expect(parseThemeChoice("")).toBeNull();
    expect(parseThemeChoice(undefined)).toBeNull();
    expect(parseThemeChoice(42)).toBeNull();
  });
});

describe("themeAttribute", () => {
  it("uses the instance default when the member has not chosen", () => {
    expect(themeAttribute(undefined, "dark")).toBe("dark");
    expect(themeAttribute(undefined, "light")).toBe("light");
    expect(themeAttribute(undefined, "system")).toBeNull();
  });

  it("lets the member's choice win over the instance default", () => {
    expect(themeAttribute("light", "dark")).toBe("light");
    expect(themeAttribute("dark", "light")).toBe("dark");
  });

  it("lets a member choose to follow the phone even when the instance default is fixed", () => {
    expect(themeAttribute("system", "dark")).toBeNull();
  });

  it("ignores a cookie it does not recognise", () => {
    expect(themeAttribute("javascript:alert(1)", "light")).toBe("light");
  });
});
