import { describe, expect, it } from "vitest";
import { renderEmail } from "@/email/render";
import type { EmailBrand } from "@/email/template";
import { RADIUS_OPTIONS } from "@/instance/options";

const brand: EmailBrand = { name: "Green Valley", primary: "#0B6E4F", radius: "lg", fontFamily: "DM Sans", logoUrl: null };
const content = { heading: "Email is working", paragraphs: ["Hello there."], button: { label: "Open", url: "https://club.example.org/" } };

describe("the email layout", () => {
  it("is a real HTML page with the instance name, heading, text and button", async () => {
    const { html } = await renderEmail(brand, content);
    expect(html.toLowerCase().startsWith("<!doctype html")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("Green Valley");
    expect(html).toContain("Email is working");
    expect(html).toContain("Hello there.");
    expect(html).toContain('href="https://club.example.org/"');
    expect(html).toContain("Sent by Green Valley.");
  });

  it("writes the brand colour, text colour on it, corner style and font into the styles", async () => {
    const { html } = await renderEmail(brand, content);
    expect(html).toMatch(/background(?:-color)?:#[0-9a-f]{6}/i);
    expect(html).toContain("border-radius:16px");
    expect(html).toContain("font-family:&#x27;DM Sans&#x27;");
    expect(html).toContain("Helvetica");
  });

  it.each(RADIUS_OPTIONS)("follows the %s corner style", async (radius) => {
    const px = { zero: "0px", sm: "4px", md: "8px", lg: "16px" }[radius];
    const { html } = await renderEmail({ ...brand, radius }, content);
    expect(html).toContain(`border-radius:${px}`);
  });

  it.each(["#000000", "#FFFFFF", "#FFFF00", "#0000FF", "#0B6E4F"])("renders with the extreme brand colour %s", async (primary) => {
    const { html } = await renderEmail({ ...brand, primary }, content);
    expect(html).toContain("Open");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("has a plain-text copy with no markup, and the link written out", async () => {
    const { text } = await renderEmail(brand, content);
    // The heading is shown in capitals in plain text.
    expect(text.toLowerCase()).toContain("email is working");
    expect(text).toContain("Hello there.");
    expect(text).toContain("https://club.example.org/");
    expect(text).not.toMatch(/<\/?[a-z]/i);
  });

  it("shows the name as text with no logo, and the picture when there is a PNG", async () => {
    expect((await renderEmail(brand, content)).html).not.toContain("<img");
    const logoUrl = "https://club.example.org/media/instance/abcdefghijklmnopqrstuvwx.png";
    const { html } = await renderEmail({ ...brand, logoUrl }, content);
    expect(html).toContain(`src="${logoUrl}"`);
    expect(html).toContain('alt="Green Valley"');
  });

  it("escapes everything that came from a person, so a name or message cannot add markup", async () => {
    // Built in pieces: it is test data for an attack, not a picture on the page.
    const injectedTag = ["<", "img src=x onerror=", '"y"', ">"].join("");
    const evil = { ...brand, name: '<script>alert(1)</script> & "Co"' };
    const { html } = await renderEmail(evil, { heading: "<b>x</b>", paragraphs: ["a < b & c", injectedTag] });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves out a button whose address is not http or https", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi", 'https://x.test/"onclick="x', "ftp://x.test"]) {
      const { html, text } = await renderEmail(brand, { heading: "h", paragraphs: ["p"], button: { label: "Go", url } });
      expect(html).not.toMatch(/<a [^>]*href/i);
      expect(text).not.toContain("Go");
    }
  });

  it("keeps odd characters out of the font stack", async () => {
    const { html } = await renderEmail({ ...brand, fontFamily: "Inter';}body{display:none" }, content);
    // Only letters, digits and spaces survive, so the quote and brace cannot end the font name early.
    expect(html).toContain("font-family:&#x27;Interbodydisplaynone&#x27;");
    expect(html).not.toContain("Inter&#x27;;}");
    expect(html).not.toContain("body{");
  });

  it("makes no request: no stylesheet, script, web font or tracking pixel", async () => {
    const { html } = await renderEmail(brand, content);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|@font-face/i);
    // The only outside address is the standard document type line at the very top.
    expect(html).not.toMatch(/https?:\/\/(?!club\.example\.org|www\.w3\.org)/i);
  });
});
