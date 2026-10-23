import { describe, expect, it } from "vitest";
import { checkGif, GIF_TITLE_MAX, isKlipyMediaUrl, klipyUrl, KLIPY_KEY_PATTERN, parseKlipyPage } from "@/lib/gif";

const GOOD = "https://static.klipy.com/ii/abc/def/md.webp";

describe("isKlipyMediaUrl", () => {
  it("accepts Klipy's three media hosts with a .gif or .webp ending", () => {
    expect(isKlipyMediaUrl(GOOD)).toBe(true);
    expect(isKlipyMediaUrl("https://static1.klipy.com/a/b.gif")).toBe(true);
    expect(isKlipyMediaUrl("https://static2.klipy.com/a/b.GIF")).toBe(true);
  });

  it.each([
    ["plain http", "http://static.klipy.com/a.gif"],
    ["another host", "https://example.com/a.gif"],
    ["lookalike host", "https://static.klipy.com.evil.com/a.gif"],
    ["lookalike prefix", "https://evilstatic.klipy.com/a.gif"],
    ["login in the address", "https://user:pw@static.klipy.com/a.gif"],
    ["a port", "https://static.klipy.com:8443/a.gif"],
    ["a backslash trick", "https://static.klipy.com\\@evil.com/a.gif"],
    ["not a picture", "https://static.klipy.com/a.html"],
    ["an mp4", "https://static.klipy.com/a.mp4"],
    ["a space", "https://static.klipy.com/a b.gif"],
    ["a new line", "https://static.klipy.com/a.gif\n"],
    ["the api host", "https://api.klipy.com/a.gif"],
    ["too long", `https://static.klipy.com/${"a".repeat(500)}.gif`],
  ])("refuses %s", (_name, url) => {
    expect(isKlipyMediaUrl(url)).toBe(false);
  });

  it("refuses things that are not text", () => {
    for (const v of [undefined, null, 5, {}, []]) expect(isKlipyMediaUrl(v)).toBe(false);
  });
});

describe("checkGif", () => {
  it("treats nothing as no GIF", () => {
    expect(checkGif(undefined)).toEqual({ ok: true, gif: null });
    expect(checkGif(null)).toEqual({ ok: true, gif: null });
  });

  it("accepts a good GIF and tidies the title", () => {
    expect(checkGif({ url: GOOD, width: 320, height: 240, title: "  happy   dance \n" })).toEqual({
      ok: true,
      gif: { url: GOOD, width: 320, height: 240, title: "happy dance" },
    });
  });

  it("keeps no title when it is blank, missing or odd", () => {
    expect(checkGif({ url: GOOD, width: 1, height: 1, title: "   " })).toMatchObject({ gif: { title: null } });
    expect(checkGif({ url: GOOD, width: 1, height: 1 })).toMatchObject({ gif: { title: null } });
    expect(checkGif({ url: GOOD, width: 1, height: 1, title: "a\u0000b" })).toMatchObject({ gif: { title: null } });
    expect(checkGif({ url: GOOD, width: 1, height: 1, title: 7 })).toMatchObject({ gif: { title: null } });
  });

  it("cuts a long title", () => {
    const result = checkGif({ url: GOOD, width: 1, height: 1, title: "x".repeat(300) });
    expect(result.ok && result.gif?.title?.length).toBe(GIF_TITLE_MAX);
  });

  it.each([
    ["a bad address", { url: "https://example.com/a.gif", width: 10, height: 10 }],
    ["zero width", { url: GOOD, width: 0, height: 10 }],
    ["a huge height", { url: GOOD, width: 10, height: 99999 }],
    ["a fraction", { url: GOOD, width: 10.5, height: 10 }],
    ["text for a size", { url: GOOD, width: "10", height: 10 }],
    ["a missing size", { url: GOOD, width: 10 }],
    ["an array", [GOOD]],
    ["a plain string", GOOD],
  ])("refuses %s", (_name, raw) => {
    expect(checkGif(raw)).toEqual({ ok: false });
  });
});

const file = (kind: string, n: number) => ({ url: `https://static.klipy.com/${kind}/${n}`, width: 100 * n, height: 50 * n });

function sample(extra: Record<string, unknown> = {}) {
  return {
    result: true,
    data: {
      data: [
        {
          id: 1,
          slug: "one",
          title: "First GIF",
          file: {
            hd: { gif: file("gif", 4) , webp: file("webp", 4) },
            md: { gif: { ...file("gif", 3), url: "https://static.klipy.com/m/3.gif" }, webp: { ...file("webp", 3), url: "https://static1.klipy.com/m/3.webp" } },
            sm: { gif: { ...file("gif", 2), url: "https://static.klipy.com/s/2.gif" }, webp: { ...file("webp", 2), url: "https://static.klipy.com/s/2.webp" } },
            xs: { gif: { ...file("gif", 1), url: "https://static.klipy.com/x/1.gif" } },
          },
        },
        { id: 2, title: "Elsewhere", file: { md: { gif: { url: "https://example.com/a.gif", width: 10, height: 10 } } } },
        { id: 3, title: "", file: { md: { gif: { url: "https://static2.klipy.com/m/c.gif", width: 40, height: 30 } }, sm: { gif: { url: "https://static2.klipy.com/s/c.gif", width: 20, height: 15 } } } },
        { nonsense: true },
      ],
      has_next: true,
      ...extra,
    },
  };
}

describe("parseKlipyPage", () => {
  it("keeps Klipy's order, skips what it cannot use, and picks the right sizes", () => {
    const page = parseKlipyPage(sample());
    expect(page?.hasNext).toBe(true);
    expect(page?.items.map((i) => i.id)).toEqual(["1", "3"]);
    const first = page!.items[0]!;
    expect(first.post).toEqual({ url: "https://static1.klipy.com/m/3.webp", width: 300, height: 150, title: "First GIF" });
    expect(first.preview.url).toBe("https://static.klipy.com/s/2.webp");
  });

  it("falls back to the GIF and a plain name when the title is empty", () => {
    const third = parseKlipyPage(sample())!.items[1]!;
    expect(third.post.url).toBe("https://static2.klipy.com/m/c.gif");
    expect(third.title).toBe("GIF");
    expect(third.post.title).toBeNull();
  });

  it("says no more pages when Klipy says so", () => {
    expect(parseKlipyPage({ result: true, data: { data: [] } })).toEqual({ items: [], hasNext: false });
  });

  it("refuses an answer that is not Klipy's shape", () => {
    expect(parseKlipyPage({ result: false, errors: { message: ["The provided API key is invalid."] } })).toBeNull();
    expect(parseKlipyPage(null)).toBeNull();
    expect(parseKlipyPage("hello")).toBeNull();
    expect(parseKlipyPage({ result: true, data: {} })).toBeNull();
  });
});

describe("klipyUrl", () => {
  it("asks for trending when nothing is typed", () => {
    const url = new URL(klipyUrl("abcdefgh12", "   ", 1));
    expect(url.origin).toBe("https://api.klipy.com");
    expect(url.pathname).toBe("/api/v1/abcdefgh12/gifs/trending");
    expect(url.searchParams.get("q")).toBeNull();
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("searches with the words, a page and the middle safety level, and sends no member id", () => {
    const url = new URL(klipyUrl("abcdefgh12", " happy dance ", 3));
    expect(url.pathname).toBe("/api/v1/abcdefgh12/gifs/search");
    expect(url.searchParams.get("q")).toBe("happy dance");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("per_page")).toBe("24");
    expect(url.searchParams.get("content_filter")).toBe("medium");
    expect(url.searchParams.get("format_filter")).toBe("gif,webp");
    expect(url.searchParams.has("customer_id")).toBe(false);
  });

  it("cannot be steered to another path by an odd key", () => {
    expect(new URL(klipyUrl("a/../../x?y=1", "", 1)).hostname).toBe("api.klipy.com");
    expect(new URL(klipyUrl("a/../../x?y=1", "", 1)).pathname.startsWith("/api/v1/a%2F")).toBe(true);
  });
});

describe("KLIPY_KEY_PATTERN", () => {
  it("allows letters, numbers, dash and underscore only", () => {
    expect(KLIPY_KEY_PATTERN.test("abcDEF123_-xyz")).toBe(true);
    for (const bad of ["short", "has space1234", "slash/1234567", "q?1234567", "é12345678", ""]) expect(KLIPY_KEY_PATTERN.test(bad)).toBe(false);
  });
});
