import { describe, expect, it } from "vitest";
import { cardImage, charsetOf, cleanText, decodeEntities, parseCard } from "@/links/html";

const base = new URL("https://www.news.example.com/world/story-1?x=1");
const page = (head: string, body = "<p>hi</p>") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("parseCard", () => {
  it("reads the Open Graph tags", () => {
    const card = parseCard(
      page(`<title>Plain title</title>
        <meta property="og:title" content="The &quot;Big&quot; Story &amp; more">
        <meta property="og:description" content="A short summary.">
        <meta property="og:image" content="https://cdn.example.com/pic.jpg">
        <meta property="og:site_name" content="The Daily Example">`),
      base,
    );
    expect(card).toEqual({ title: 'The "Big" Story & more', description: "A short summary.", image: "https://cdn.example.com/pic.jpg", site: "The Daily Example" });
  });

  it("falls back to Twitter's tags, then the plain title and description, and names the site from the address", () => {
    expect(parseCard(page(`<meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://i.example.com/a.png">`), base)).toEqual({
      title: "T",
      description: "D",
      image: "https://i.example.com/a.png",
      site: "news.example.com",
    });
    expect(parseCard(page(`<title>  Just   a
      title </title><meta name="description" content="Plain description">`), base)).toEqual({
      title: "Just a title",
      description: "Plain description",
      image: null,
      site: "news.example.com",
    });
  });

  it("prefers the secure picture address, and makes a relative one absolute", () => {
    expect(parseCard(page(`<title>T</title><meta property="og:image" content="http://x.example.com/a.png"><meta property="og:image:secure_url" content="https://x.example.com/a.png">`), base)?.image).toBe("https://x.example.com/a.png");
    expect(parseCard(page(`<title>T</title><meta property="og:image" content="/img/a.png">`), base)?.image).toBe("https://www.news.example.com/img/a.png");
    expect(parseCard(page(`<title>T</title><meta property="og:image" content="//cdn.example.com/a.png">`), base)?.image).toBe("https://cdn.example.com/a.png");
  });

  it("reads attributes in any order, quoted either way or not at all, in any case", () => {
    expect(parseCard(page(`<META CONTENT='Single' PROPERTY=og:title>`), base)?.title).toBe("Single");
    expect(parseCard(page(`<meta content=Unquoted property="og:title" />`), base)?.title).toBe("Unquoted");
  });

  it("has no card without a title", () => {
    expect(parseCard(page(`<meta property="og:description" content="only this">`), base)).toBeNull();
    expect(parseCard(page(`<title>   </title>`), base)).toBeNull();
    expect(parseCard("", base)).toBeNull();
    expect(parseCard("not html at all", base)).toBeNull();
  });

  it("takes the first of a tag that appears twice", () => {
    expect(parseCard(page(`<meta property="og:title" content="First"><meta property="og:title" content="Second">`), base)?.title).toBe("First");
  });

  it("ignores what is after the head", () => {
    expect(parseCard(page(`<title>Head</title>`, `<meta property="og:title" content="Body">`), base)?.title).toBe("Head");
  });

  it("keeps the text as text: tags and scripts in a title are never markup", () => {
    const card = parseCard(page(`<meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt; hi"><meta property="og:description" content="<b>bold</b> &#60;i&#62;">`), base);
    expect(card?.title).toBe("<script>alert(1)</script> hi");
    expect(card?.description).toBe("<b>bold</b> <i>");
  });

  it("cuts long text, and strips control and direction-changing characters", () => {
    const card = parseCard(page(`<meta property="og:title" content="${"a".repeat(400)}"><meta property="og:description" content="${"b".repeat(900)}"><meta property="og:site_name" content="${"c".repeat(200)}">`), base)!;
    expect(Array.from(card.title)).toHaveLength(150);
    expect(card.title.endsWith("...")).toBe(true);
    expect(Array.from(card.description)).toHaveLength(300);
    expect(Array.from(card.site)).toHaveLength(60);
    expect(parseCard(page(`<meta property="og:title" content="a‮b\u0000c​d">`), base)?.title).toBe("a b c d");
  });

  it("drops a picture that is not https, not a real domain, has a login, or is too long", () => {
    for (const bad of ["http://cdn.example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://127.0.0.1/a.png", "https://localhost/a.png", "https://u:p@cdn.example.com/a.png", "https://cdn.example.com:8443/a.png", `https://cdn.example.com/${"a".repeat(500)}`, "ftp://cdn.example.com/a.png"]) {
      expect(parseCard(page(`<title>T</title><meta property="og:image" content="${bad}">`), base)?.image, bad).toBeNull();
    }
  });
});

describe("cardImage", () => {
  it("accepts https on a real domain and resolves against the page", () => {
    expect(cardImage("https://cdn.example.com/a.png", base)).toBe("https://cdn.example.com/a.png");
    expect(cardImage("a.png", base)).toBe("https://www.news.example.com/world/a.png");
    expect(cardImage("  https://cdn.example.com/b.png  ", base)).toBe("https://cdn.example.com/b.png");
  });
});

describe("decodeEntities and cleanText", () => {
  it("decodes named, decimal and hex entities, and leaves unknown names alone", () => {
    expect(decodeEntities("Tom &amp; Jerry &lt;3 &#39;x&#39; &#x1F600; &madeup; &nbsp;|")).toBe("Tom & Jerry <3 'x' \u{1F600} &madeup;  |");
  });

  it("turns impossible code points into a space", () => {
    expect(decodeEntities("a&#0;b&#55357;c&#1114112;d&#x110000;e")).toBe("a b c d e");
  });

  it("collapses whitespace", () => {
    expect(cleanText("  a \n\t b   c ", 50)).toBe("a b c");
  });
});

describe("charsetOf", () => {
  it("reads the header first, then the page, and defaults to utf-8", () => {
    expect(charsetOf("text/html; charset=ISO-8859-1", "")).toBe("iso-8859-1");
    expect(charsetOf("text/html", `<meta charset="windows-1252">`)).toBe("windows-1252");
    expect(charsetOf("text/html", `<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">`)).toBe("shift_jis");
    expect(charsetOf(null, "<html>")).toBe("utf-8");
  });
});
