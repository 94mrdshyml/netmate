import { describe, expect, it } from "vitest";
import { findLinks, firstLink, normalizePostLink, POST_LINK_MAX } from "@/lib/post-links";

const hrefs = (text: string) => findLinks(text).map((l) => l.href);
const texts = (text: string) => findLinks(text).map((l) => l.text);

describe("normalizePostLink", () => {
  it("accepts http and https addresses of a real domain, and adds https to www.", () => {
    expect(normalizePostLink("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(normalizePostLink("http://sub.example.co.uk")).toBe("http://sub.example.co.uk/");
    expect(normalizePostLink("www.example.org/x")).toBe("https://www.example.org/x");
    expect(normalizePostLink("HTTPS://Example.COM")).toBe("https://example.com/");
  });

  it.each([
    "ftp://example.com",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://localhost/a",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://[::1]/",
    "https://user:pw@example.com/",
    "https://example/",
    "https://exa mple.com",
    "example.com",
    "https://",
    `https://example.com/${"a".repeat(POST_LINK_MAX)}`,
  ])("refuses %s", (raw) => {
    expect(normalizePostLink(raw)).toBeNull();
  });
});

describe("findLinks", () => {
  it("finds each address with where it sits, and the text around it comes back whole", () => {
    const text = "read https://a.example.com/x and www.b.example.org too";
    const found = findLinks(text);
    expect(found.map((l) => text.slice(l.start, l.end))).toEqual(["https://a.example.com/x", "www.b.example.org"]);
    expect(found.map((l) => l.href)).toEqual(["https://a.example.com/x", "https://www.b.example.org/"]);
  });

  it("leaves sentence punctuation out of the address", () => {
    expect(texts("see https://example.com/a. Then https://example.com/b, and (https://example.com/c)!")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    expect(texts('"https://example.com/q?x=1"')).toEqual(["https://example.com/q?x=1"]);
  });

  it("keeps a closing bracket that belongs to the address", () => {
    expect(texts("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(texts("(see https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
  });

  it("finds nothing in plain words, an email, or an address that is not allowed", () => {
    expect(hrefs("no links here, me@example.com, example.com, ftp://example.com, https://localhost/x")).toEqual([]);
  });

  it("ends an address at a quote or the start of a tag, so typed markup never becomes part of one", () => {
    expect(texts('<a href="https://example.com/x">y</a>')).toEqual(["https://example.com/x"]);
    expect(texts("https://example.com/x<script>alert(1)</script>")).toEqual(["https://example.com/x"]);
  });

  it("works across lines", () => {
    expect(hrefs("one\nhttps://example.com/a\ntwo\nhttps://example.com/b")).toEqual(["https://example.com/a", "https://example.com/b"]);
  });
});

describe("firstLink", () => {
  it("is the first address, or null", () => {
    expect(firstLink("a https://example.com/1 b https://example.com/2")).toBe("https://example.com/1");
    expect(firstLink("nothing")).toBeNull();
    expect(firstLink("")).toBeNull();
  });
});
