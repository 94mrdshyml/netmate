import { describe, expect, it } from "vitest";
import { checkLinkCard } from "@/links/card";

const good = { url: "https://news.example.com/story", title: "A headline", description: "About it.", image: "https://cdn.example.com/p.png", site: "Example News" };

describe("checkLinkCard", () => {
  it("passes a whole card unchanged, with or without a picture or description", () => {
    expect(checkLinkCard(good)).toEqual(good);
    expect(checkLinkCard({ ...good, image: null, description: "" })).toEqual({ ...good, image: null, description: "" });
    expect(checkLinkCard({ url: good.url, title: "T", image: null, site: "S" })).toEqual({ url: good.url, title: "T", description: "", image: null, site: "S" });
  });

  it("drops fields it does not know", () => {
    expect(checkLinkCard({ ...good, extra: "<script>", html: "<b>x</b>" })).toEqual(good);
  });

  it("refuses text that is not already clean one-line plain text of the right size", () => {
    for (const bad of [{ title: "" }, { title: "  x" }, { title: "a\nb" }, { title: "a‮b" }, { title: "x".repeat(151) }, { description: "x".repeat(301) }, { site: "" }, { site: "x".repeat(61) }, { title: 5 }, { site: null }]) {
      expect(checkLinkCard({ ...good, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses an address a post would not link to, or one that is not in its normal form", () => {
    for (const url of ["ftp://x.example.com/", "https://127.0.0.1/", "https://localhost/", "https://u:p@x.example.com/", "https://X.EXAMPLE.com", "x.example.com", "", 5, null]) {
      expect(checkLinkCard({ ...good, url }), String(url)).toBeNull();
    }
  });

  it("refuses a picture that is not an https address on a real domain", () => {
    for (const image of ["http://cdn.example.com/p.png", "//cdn.example.com/p.png", "/p.png", "https://127.0.0.1/p.png", "https://cdn.example.com:8443/p.png", "https://u:p@cdn.example.com/p.png", "data:image/png;base64,AA", 5, `https://cdn.example.com/${"a".repeat(500)}`]) {
      expect(checkLinkCard({ ...good, image }), String(image)).toBeNull();
    }
  });

  it("refuses what is not an object", () => {
    for (const junk of [null, undefined, "x", 5, [], [good]]) expect(checkLinkCard(junk)).toBeNull();
  });
});
