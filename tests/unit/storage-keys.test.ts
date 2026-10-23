import { describe, expect, it } from "vitest";
import { MEDIA_PREFIXES, mediaKindOf, newMediaKey } from "@/storage/keys";

describe("newMediaKey", () => {
  it("puts avatars, banners and post pictures in their own prefixes", () => {
    expect(newMediaKey("avatar", "usr_abc", "webp")).toMatch(/^avatars\/usr_abc\/[0-9A-Za-z]{24}\.webp$/);
    expect(newMediaKey("banner", "usr_abc", "jpg")).toMatch(/^banners\/usr_abc\/[0-9A-Za-z]{24}\.jpg$/);
    expect(newMediaKey("post", "post_abc", "png")).toMatch(/^posts\/post_abc\/[0-9A-Za-z]{24}\.png$/);
  });

  it("never reuses a name, so a replaced picture cannot serve from a stale cache", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newMediaKey("avatar", "usr_abc", "png")));
    expect(keys.size).toBe(200);
  });
});

describe("mediaKindOf", () => {
  it("names the kind of a stored key", () => {
    expect(mediaKindOf(newMediaKey("avatar", "usr_a", "png"))).toBe("avatar");
    expect(mediaKindOf(newMediaKey("banner", "usr_a", "png"))).toBe("banner");
    expect(mediaKindOf(newMediaKey("post", "post_a", "png"))).toBe("post");
    expect(mediaKindOf("instance/logo.png")).toBe("instance");
    expect(mediaKindOf("fonts/inter-400.woff2")).toBe("font");
  });

  it("does not claim keys that are not ours", () => {
    expect(mediaKindOf("avatars")).toBeNull();
    expect(mediaKindOf("evil/avatars/x.png")).toBeNull();
    expect(mediaKindOf("")).toBeNull();
  });

  it("has a distinct prefix for every kind", () => {
    const prefixes = Object.values(MEDIA_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
