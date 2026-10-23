import { describe, expect, it } from "vitest";
import { fontFaceCss, fontSlug, parseFontCss, type FontFaceRow } from "@/instance/fonts";
import { buildThemeCss } from "@/instance/theme";

const block = (subset: string, weight: number, file: string, range: string) => `/* ${subset} */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/${file}.woff2) format('woff2');
  unicode-range: ${range};
}
`;

const GOOGLE =
  block("cyrillic", 400, "cyr", "U+0301, U+0400-045F") +
  block("latin-ext", 400, "ext", "U+0100-02BA, U+02BD-02C5") +
  block("latin", 700, "lat", "U+0000-00FF, U+0131, U+0152-0153");

describe("parseFontCss", () => {
  it("keeps the latin and latin-ext blocks and skips other scripts", () => {
    const faces = parseFontCss(GOOGLE);
    expect(faces.map((f) => [f.subset, f.weight, f.style])).toEqual([
      ["latin-ext", 400, "normal"],
      ["latin", 700, "normal"],
    ]);
    expect(faces[0]!.url).toBe("https://fonts.gstatic.com/s/inter/v20/ext.woff2");
    expect(faces[1]!.unicodeRange).toBe("U+0000-00FF, U+0131, U+0152-0153");
  });

  it("never lets text after the range through, and skips a block with no range or no file", () => {
    // The block ends at its first closing brace, so only the plain range is read.
    expect(parseFontCss(block("latin", 400, "a", "U+0000; } body { display: none")).map((f) => f.unicodeRange)).toEqual(["U+0000"]);
    expect(parseFontCss(block("latin", 400, "a", "red; background: url(x)"))).toEqual([]);
    expect(parseFontCss(block("latin", 400, "a", "U+0000").replace(/\s*unicode-range:[^;]*;/, ""))).toEqual([]);
    expect(parseFontCss(block("latin", 400, "a", "U+0000").replace(/src:[^;]*;/, ""))).toEqual([]);
    expect(parseFontCss("")).toEqual([]);
  });

  it("skips a block that is not woff2", () => {
    expect(parseFontCss(block("latin", 400, "a", "U+0000").replace("format('woff2')", "format('truetype')"))).toEqual([]);
  });
});

describe("fontSlug", () => {
  it("makes a safe folder name", () => {
    expect(fontSlug("DM Sans")).toBe("dm-sans");
    expect(fontSlug("JetBrains Mono")).toBe("jetbrains-mono");
    expect(fontSlug("Inter")).toBe("inter");
  });
});

const face = (over: Partial<FontFaceRow> = {}): FontFaceRow => ({
  weight: 400,
  style: "normal",
  subset: "latin",
  unicodeRange: "U+0000-00FF, U+0131",
  storageKey: "fonts/inter/abcdefghijklmnopqrstuvwx.woff2",
  ...over,
});

describe("fontFaceCss", () => {
  it("writes one @font-face per hosted file pointing at our own media route", () => {
    const css = fontFaceCss("Inter", [face(), face({ weight: 700, storageKey: "fonts/inter/ABCDEFGHIJKLMNOPQRSTUVWX.woff2" })]);
    expect(css).toContain('font-family:"Inter"');
    expect(css).toContain('src:url(/media/fonts/inter/abcdefghijklmnopqrstuvwx.woff2) format("woff2")');
    expect(css).toContain("font-weight:700");
    expect(css).toContain("font-display:swap");
    expect(css).not.toMatch(/https?:/);
  });

  it("drops a face whose key or range is not what we store, so nothing can be injected", () => {
    expect(fontFaceCss("Inter", [face({ storageKey: "fonts/inter/x.woff2); } body{display:none" })])).toBe("");
    expect(fontFaceCss("Inter", [face({ storageKey: "https://evil.test/a.woff2" })])).toBe("");
    expect(fontFaceCss("Inter", [face({ unicodeRange: "U+0000;} body{display:none" })])).toBe("");
    expect(fontFaceCss("Inter", [])).toBe("");
  });

  it("goes in front of the theme rules", () => {
    const { css } = buildThemeCss({ primary: "#0B6E4F", radius: "md", fontFamily: "Inter" }, fontFaceCss("Inter", [face()]));
    expect(css.startsWith("@font-face{")).toBe(true);
    expect(css).toContain(":root{--radius:8px");
  });
});
