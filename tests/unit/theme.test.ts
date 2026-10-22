import { describe, expect, it } from "vitest";
import { oklchToRgb, parseHex, toHex } from "@/lib/color";
import { DEFAULT_THEME } from "@/instance/defaults";
import {
  FILL_CONTRAST,
  RADII,
  TEXT_CONTRAST,
  buildThemeCss,
  contrastOf,
  deriveTheme,
  isValidFontFamily,
} from "@/instance/theme";

// Colours an admin might plausibly pick, plus the nasty ones.
const AWKWARD = [
  "#FFFFFF", "#000000", "#FEFEFE", "#010101", "#FFD400", "#FFFF00", "#00FF00", "#FF0000",
  "#0000FF", "#FF00FF", "#00FFFF", "#808080", "#767676", "#777777", "#2F6FED", "#B25030",
  "#0B1D51", "#F5E6A8", "#7A6000", "#ABC", "#a1b2c3",
];

// A sweep over hue, lightness and chroma, so no region of colour space is untested.
function sweep(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 360; h += 20) {
    for (const l of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 0.98]) {
      for (const c of [0.02, 0.1, 0.2, 0.3]) {
        out.push(toHex(oklchToRgb({ l, c, h })));
      }
    }
  }
  return out;
}

describe("deriveTheme keeps every colour readable in both themes", () => {
  for (const hex of [...AWKWARD, ...sweep()]) {
    it(hex, () => {
      const t = deriveTheme(hex);
      for (const mode of ["light", "dark"] as const) {
        const m = t[mode];
        const bg = parseHex(m.bg)!;
        // Brand-coloured text on the page.
        expect(contrastOf(m.brandText, m.bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        // The button fill stands out from the page.
        expect(contrastOf(m.brand, m.bg)).toBeGreaterThanOrEqual(FILL_CONTRAST);
        // Text on the fill, and on hover and pressed.
        expect(contrastOf(m.onBrand, m.brand)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        expect(contrastOf(m.onBrand, m.brandHover)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        expect(contrastOf(m.onBrand, m.brandPressed)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        // Body text on the page.
        expect(contrastOf(m.fg, toHex(bg))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      }
    });
  }
});

describe("deriveTheme", () => {
  it("uses true black and white pages", () => {
    const t = deriveTheme("#2F6FED");
    expect(t.light.bg).toBe("#FFFFFF");
    expect(t.dark.bg).toBe("#000000");
  });

  it("keeps a colour that already works, and says so", () => {
    const t = deriveTheme("#2F6FED");
    expect(t.light.brand).toBe("#2F6FED");
    expect(t.adjusted.light).toBe(false);
  });

  it("adjusts a yellow in the light theme (the old gold-on-white problem) and reports it", () => {
    const t = deriveTheme("#FFD400");
    expect(t.adjusted.light).toBe(true);
    expect(t.adjusted.dark).toBe(false);
    expect(t.dark.brand).toBe("#FFD400");
    expect(t.light.brandText).not.toBe("#FFD400");
    expect(contrastOf(t.light.brandText, t.light.bg)).toBeGreaterThanOrEqual(4.5);
    // Black text on a yellow button.
    expect(t.dark.onBrand).toBe("#000000");
  });

  it("adjusts a very dark colour in the dark theme", () => {
    const t = deriveTheme("#0B1D51");
    expect(t.adjusted.dark).toBe(true);
    expect(t.adjusted.light).toBe(false);
  });

  it("accepts shorthand hex and is case-insensitive", () => {
    expect(deriveTheme("#abc")).toEqual(deriveTheme("#AABBCC"));
  });

  it("throws on anything that is not a hex colour", () => {
    for (const bad of ["", "blue", "#12", "red; background:url(x)", "#fff}body{x:y"]) {
      expect(() => deriveTheme(bad)).toThrow(RangeError);
    }
  });
});

describe("buildThemeCss", () => {
  it("emits variables for both themes and the chosen radius and font", () => {
    const { css } = buildThemeCss({ primary: "#2F6FED", radius: "lg", fontFamily: "Space Grotesk" });
    expect(css).toContain(`--radius:${RADII.lg}`);
    expect(css).toContain('--font:"Space Grotesk",system-ui,sans-serif');
    expect(css).toContain("--brand:#2F6FED");
    expect(css).toContain("prefers-color-scheme:dark");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it("maps every radius option to its fixed size", () => {
    expect(RADII).toEqual({ zero: "0px", sm: "4px", md: "8px", lg: "16px" });
    for (const radius of Object.keys(RADII) as (keyof typeof RADII)[]) {
      expect(buildThemeCss({ ...DEFAULT_THEME, radius }).css).toContain(`--radius:${RADII[radius]}`);
    }
  });

  it("builds from the defaults without adjustment", () => {
    const { css, adjusted } = buildThemeCss(DEFAULT_THEME);
    expect(css.length).toBeGreaterThan(100);
    expect(adjusted).toEqual({ light: false, dark: false });
  });

  it("cannot be used to inject CSS or script through any setting", () => {
    const attacks = [
      { ...DEFAULT_THEME, primary: "#fff;}body{background:url(//evil)}" },
      { ...DEFAULT_THEME, primary: "red" },
      { ...DEFAULT_THEME, radius: "huge" as never },
      { ...DEFAULT_THEME, radius: "constructor" as never },
      { ...DEFAULT_THEME, fontFamily: 'x";}body{display:none}/*' },
      { ...DEFAULT_THEME, fontFamily: "Inter</style><script>alert(1)</script>" },
      { ...DEFAULT_THEME, fontFamily: "" },
    ];
    for (const settings of attacks) {
      expect(() => buildThemeCss(settings)).toThrow(RangeError);
    }
  });

  it("never lets a quote, brace, angle bracket or semicolon from settings into the output", () => {
    const { css } = buildThemeCss({ primary: "#abc", radius: "sm", fontFamily: "Roboto Mono" });
    expect(css).not.toMatch(/[<>]/);
    // Quotes appear only around the font name and the data-theme selector values.
    expect(css.match(/"/g)?.length).toBe(6);
  });
});

describe("isValidFontFamily", () => {
  it("allows plain family names", () => {
    for (const ok of ["Inter", "Space Grotesk", "IBM Plex Sans", "Roboto Mono", "Fira Code 2"]) {
      expect(isValidFontFamily(ok)).toBe(true);
    }
  });

  it("rejects anything with punctuation, or too long", () => {
    for (const bad of ["", " Inter", "Inter;", "In'ter", 'In"ter', "In\\ter", "Inter, serif", "a".repeat(61)]) {
      expect(isValidFontFamily(bad)).toBe(false);
    }
  });
});
