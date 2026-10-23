import { describe, expect, it } from "vitest";
import { defaultAvatarSvg, isAvatarStyle } from "@/avatars/default";
import { AVATAR_STYLES } from "@/instance/options";

const person = { username: "riya_sen", name: "Riya Sen" };

describe("defaultAvatarSvg", () => {
  it.each(AVATAR_STYLES)("draws a real SVG in the %s style", (style) => {
    const svg = defaultAvatarSvg(style, person);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg.length).toBeGreaterThan(300);
  });

  it("gives the same picture every time for the same person", () => {
    expect(defaultAvatarSvg("shapes", person)).toBe(defaultAvatarSvg("shapes", person));
  });

  it("gives different people different pictures (seeded by the username)", () => {
    const other = { ...person, username: "riya_sen2" };
    for (const style of ["shapes", "thumbs", "rings", "glass", "identicon"] as const) {
      expect(defaultAvatarSvg(style, person)).not.toBe(defaultAvatarSvg(style, other));
    }
  });

  it("tells two people with the same name apart, in every style including initials", () => {
    const twin = { username: "sam_lee_2", name: "Sam Lee" };
    const first = { username: "sam_lee", name: "Sam Lee" };
    for (const style of AVATAR_STYLES) {
      expect(defaultAvatarSvg(style, first)).not.toBe(defaultAvatarSvg(style, twin));
    }
  });

  it("keeps a picture when only the name changes, except for the initials style which draws the name", () => {
    const renamed = { ...person, name: "Riya Sen-Gupta" };
    expect(defaultAvatarSvg("shapes", person)).toBe(defaultAvatarSvg("shapes", renamed));
    expect(defaultAvatarSvg("initials", { username: person.username, name: "Ada Lovelace" })).toContain(">AL<");
  });

  it("falls back to the default style for a style it does not know, instead of failing", () => {
    expect(defaultAvatarSvg("cameo", person)).toBe(defaultAvatarSvg("initials", person));
    expect(defaultAvatarSvg("", person)).toBe(defaultAvatarSvg("initials", person));
    expect(defaultAvatarSvg("constructor", person)).toBe(defaultAvatarSvg("initials", person));
  });

  it("contains no script and nothing that can fetch from outside, so it makes no request", () => {
    for (const style of AVATAR_STYLES) {
      // The licence text in <metadata> mentions web addresses but is only text, not a request.
      const drawn = defaultAvatarSvg(style, person).replace(/<metadata[\s\S]*?<\/metadata>/, "");
      expect(drawn).not.toMatch(/<script/i);
      expect(drawn).not.toMatch(/\son\w+=/i);
      expect(drawn).not.toMatch(/(?:xlink:)?href\s*=/i);
      expect(drawn).not.toMatch(/src\s*=/i);
      expect(drawn).not.toMatch(/@import/i);
      expect(drawn).not.toMatch(/url\(\s*["']?(?!#)/i);
      expect(drawn).not.toMatch(/https?:\/\/(?!www\.w3\.org)/i);
    }
  });
});

describe("isAvatarStyle", () => {
  it("accepts the offered styles only", () => {
    for (const s of AVATAR_STYLES) expect(isAvatarStyle(s)).toBe(true);
    expect(isAvatarStyle("lorelei")).toBe(false);
    expect(isAvatarStyle("toString")).toBe(false);
  });
});
