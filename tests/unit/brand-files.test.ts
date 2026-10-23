import { describe, expect, it } from "vitest";
import { checkBrandBytes, isSafeSvg, pngSize } from "@/storage/brand-files";
import { MEDIA_PREFIXES, newFontKey, newInstanceKey } from "@/storage/keys";
import { SVG_LOGO, pngHeader } from "../support/png";

const text = (s: string) => new TextEncoder().encode(s);
const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe("pngSize", () => {
  it("reads the width and height from the header", () => {
    expect(pngSize(pngHeader(512, 512))).toEqual({ width: 512, height: 512 });
    expect(pngSize(pngHeader(40, 12))).toEqual({ width: 40, height: 12 });
  });

  it("returns null for anything that is not a PNG with a header chunk", () => {
    expect(pngSize(new Uint8Array(10))).toBeNull();
    expect(pngSize(text("hello world, this is not a picture at all"))).toBeNull();
    const broken = pngHeader(10, 10);
    broken[12] = 0x58; // not IHDR
    expect(pngSize(broken)).toBeNull();
  });
});

describe("isSafeSvg", () => {
  it("accepts a plain drawing, with or without an xml line", () => {
    expect(isSafeSvg(SVG_LOGO)).toBe(true);
    expect(isSafeSvg(`<?xml version="1.0" encoding="UTF-8"?>\n${SVG_LOGO}\n`)).toBe(true);
  });

  it.each([
    ["a script", `<svg ${NS}><script>alert(1)</script></svg>`],
    ["an event handler", `<svg ${NS} onload="alert(1)"></svg>`],
    ["an event handler on a shape", `<svg ${NS}><circle onclick = "x()" r="1"/></svg>`],
    ["a javascript link", `<svg ${NS}><a href="javascript:alert(1)"><text>x</text></a></svg>`],
    ["any link", `<svg ${NS}><a xlink:href="https://example.com"><text>x</text></a></svg>`],
    ["an embedded page", `<svg ${NS}><foreignObject><div>hi</div></foreignObject></svg>`],
    ["an outside picture", `<svg ${NS}><image width="1" height="1"/></svg>`],
    ["a use element", `<svg ${NS}><use/></svg>`],
    ["an animation", `<svg ${NS}><animate attributeName="x"/></svg>`],
    ["a style block", `<svg ${NS}><style>@import url(https://x.test/a.css)</style></svg>`],
    ["a data address", `<svg ${NS}><circle fill="url(data:image/png;base64,AA)"/></svg>`],
    ["an outside fill", `<svg ${NS}><circle fill="url(https://x.test/a)"/></svg>`],
    ["an entity", `<!DOCTYPE svg [<!ENTITY a "b">]><svg ${NS}>&a;</svg>`],
    ["text before the svg", `hello <svg ${NS}></svg>`],
    ["text after the svg", `<svg ${NS}></svg> trailing`],
    ["no svg at all", "<html><body>hi</body></html>"],
  ])("refuses %s", (_label, svg) => {
    expect(isSafeSvg(svg)).toBe(false);
  });

  it("allows a reference to a gradient inside the same file", () => {
    expect(isSafeSvg(`<svg ${NS}><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>`)).toBe(true);
  });
});

describe("checkBrandBytes", () => {
  it("accepts a PNG logo of any sensible size and an SVG logo", () => {
    expect(checkBrandBytes("logo", pngHeader(120, 40))).toEqual({ type: "png" });
    expect(checkBrandBytes("logo", text(SVG_LOGO))).toEqual({ type: "svg" });
  });

  it("accepts a square favicon of 512 pixels or more, and an SVG favicon", () => {
    expect(checkBrandBytes("favicon", pngHeader(512, 512))).toEqual({ type: "png" });
    expect(checkBrandBytes("favicon", pngHeader(1024, 1024))).toEqual({ type: "png" });
    expect(checkBrandBytes("favicon", text(SVG_LOGO))).toEqual({ type: "svg" });
  });

  it("refuses a favicon that is too small or not square", () => {
    expect(checkBrandBytes("favicon", pngHeader(511, 511))).toEqual({ error: "bad_size" });
    expect(checkBrandBytes("favicon", pngHeader(512, 640))).toEqual({ error: "bad_size" });
  });

  it("refuses a PNG with a size of zero or an absurd size", () => {
    expect(checkBrandBytes("logo", pngHeader(0, 40))).toEqual({ error: "bad_size" });
    expect(checkBrandBytes("logo", pngHeader(9000, 40))).toEqual({ error: "bad_size" });
  });

  it("refuses an empty file, a file over 1 MB, and files that are not PNG or SVG", () => {
    expect(checkBrandBytes("logo", new Uint8Array(0))).toEqual({ error: "no_file" });
    expect(checkBrandBytes("logo", new Uint8Array(1024 * 1024 + 1))).toEqual({ error: "too_big" });
    expect(checkBrandBytes("logo", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ error: "bad_type" });
    expect(checkBrandBytes("logo", text("just some words"))).toEqual({ error: "bad_type" });
    expect(checkBrandBytes("logo", new Uint8Array([0xc3, 0x28, 0xa0, 0xa1]))).toEqual({ error: "bad_type" });
  });

  it("refuses an SVG that could run something", () => {
    expect(checkBrandBytes("logo", text(`<svg ${NS}><script>1</script></svg>`))).toEqual({ error: "bad_svg" });
  });
});

describe("instance and font keys", () => {
  it("builds keys under their own prefixes with a random name", () => {
    expect(newInstanceKey("png")).toMatch(/^instance\/[0-9A-Za-z]{24}\.png$/);
    expect(newInstanceKey("svg")).toMatch(/^instance\/[0-9A-Za-z]{24}\.svg$/);
    expect(newFontKey("dm-sans")).toMatch(/^fonts\/dm-sans\/[0-9A-Za-z]{24}\.woff2$/);
    expect(newInstanceKey("png")).not.toBe(newInstanceKey("png"));
    expect(MEDIA_PREFIXES.instance).toBe("instance");
  });
});
