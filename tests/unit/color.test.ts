import { describe, expect, it } from "vitest";
import {
  BLACK,
  WHITE,
  contrastRatio,
  ensureContrast,
  oklchToRgb,
  parseHex,
  readableOn,
  rgbToOklch,
  toHex,
} from "@/lib/color";

describe("parseHex and toHex", () => {
  it("parses six and three digit hex, any case", () => {
    expect(parseHex("#FFD400")).toEqual({ r: 255, g: 212, b: 0 });
    expect(parseHex("#fa0")).toEqual({ r: 255, g: 170, b: 0 });
    expect(parseHex("  #0a0a0a ")).toEqual({ r: 10, g: 10, b: 10 });
  });

  it("rejects everything else", () => {
    for (const bad of ["", "red", "#12", "#12345", "#1234567", "123456", "#gggggg", "rgb(0,0,0)", "#fff; x:y", "url(x)"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it("round-trips to upper-case six digit hex", () => {
    expect(toHex({ r: 255, g: 212, b: 0 })).toBe("#FFD400");
    expect(toHex(parseHex("#abc")!)).toBe("#AABBCC");
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // #777777 on white is the classic "just under 4.5" grey: 4.48
    expect(contrastRatio(parseHex("#777777")!, WHITE)).toBeCloseTo(4.48, 1);
    // #767676 on white is the darkest grey that passes AA: 4.54
    expect(contrastRatio(parseHex("#767676")!, WHITE)).toBeCloseTo(4.54, 1);
  });

  it("is symmetric", () => {
    const a = parseHex("#2F6FED")!;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });
});

describe("OKLCH", () => {
  it("round-trips colours inside the gamut", () => {
    for (const hex of ["#2F6FED", "#FFD400", "#B25030", "#00A86B", "#808080"]) {
      const rgb = parseHex(hex)!;
      const back = oklchToRgb(rgbToOklch(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThan(1.5);
      expect(Math.abs(back.g - rgb.g)).toBeLessThan(1.5);
      expect(Math.abs(back.b - rgb.b)).toBeLessThan(1.5);
    }
  });

  it("maps black and white to lightness 0 and 1", () => {
    expect(rgbToOklch(BLACK).l).toBeCloseTo(0, 3);
    expect(rgbToOklch(WHITE).l).toBeCloseTo(1, 3);
  });

  it("keeps out-of-gamut requests on screen by lowering chroma", () => {
    const rgb = oklchToRgb({ l: 0.9, c: 0.4, h: 200 });
    for (const v of [rgb.r, rgb.g, rgb.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("ensureContrast", () => {
  it("leaves a passing colour alone", () => {
    const navy = parseHex("#1A237E")!;
    expect(ensureContrast(navy, WHITE, 4.5)).toBe(navy);
  });

  it("darkens a light colour on a white page until it passes, keeping the hue", () => {
    const yellow = parseHex("#FFD400")!;
    const fixed = ensureContrast(yellow, WHITE, 4.5);
    expect(contrastRatio(fixed, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(rgbToOklch(fixed).h - rgbToOklch(yellow).h)).toBeLessThan(8);
    expect(toHex(fixed)).not.toBe(toHex(yellow));
  });

  it("lightens a dark colour on a black page until it passes", () => {
    const navy = parseHex("#1A237E")!;
    const fixed = ensureContrast(navy, BLACK, 4.5);
    expect(contrastRatio(fixed, BLACK)).toBeGreaterThanOrEqual(4.5);
  });

  it("can always reach the target, even from the worst starting colour", () => {
    expect(contrastRatio(ensureContrast(WHITE, WHITE, 4.5), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ensureContrast(BLACK, BLACK, 4.5), BLACK)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("readableOn", () => {
  it("picks black on light and white on dark", () => {
    expect(readableOn(parseHex("#FFD400")!)).toBe(BLACK);
    expect(readableOn(parseHex("#1A237E")!)).toBe(WHITE);
  });

  it("is at least 4.5:1 for every colour, even mid greys", () => {
    for (let v = 0; v <= 255; v += 5) {
      const bg = { r: v, g: v, b: v };
      expect(contrastRatio(readableOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
    for (const hex of ["#FF0000", "#00FF00", "#0000FF", "#FF00FF", "#00FFFF", "#FFFF00", "#7F7F7F", "#757575", "#0099FF"]) {
      const bg = parseHex(hex)!;
      expect(contrastRatio(readableOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
