import { describe, expect, it } from "vitest";
import { approvedForInvitee, pendingForAdmin, rejectedForInvitee } from "@/email/messages";
import { renderEmail } from "@/email/render";
import { siteUrl, type EmailBrand } from "@/email/template";

const brand: EmailBrand = { name: "Green Valley", primary: "#0B6E4F", radius: "lg", fontFamily: "DM Sans", logoUrl: null };
const who = { name: "Grace Hopper", username: "grace", invitedByName: "Owen Owner" };

describe("the sign-up status emails", () => {
  it("tell the admin who is waiting, through whom, and link to the approvals", async () => {
    const m = pendingForAdmin("Green Valley", who, "https://club.example.org/hq/approvals");
    const { html, text } = await renderEmail(brand, m.content);
    expect(m.subject).toBe("Grace Hopper is waiting for approval on Green Valley");
    expect(html).toContain("Grace Hopper");
    expect(html).toContain("@grace");
    expect(html).toContain("Owen Owner");
    expect(html).toContain('href="https://club.example.org/hq/approvals"');
    expect(text).toContain("https://club.example.org/hq/approvals");
  });

  it("do not mention an inviter that is not known", () => {
    const m = pendingForAdmin("Green Valley", { ...who, invitedByName: null }, null);
    expect(m.content.paragraphs.join(" ")).not.toContain("invite link");
    expect(m.content.button).toBeUndefined();
  });

  it("welcome an approved person by first name, with a sign-in button", async () => {
    const m = approvedForInvitee("Green Valley", "Grace", "https://club.example.org/sign-in");
    const { html } = await renderEmail(brand, m.content);
    expect(m.subject).toContain("Green Valley");
    expect(html).toContain("Hi Grace,");
    expect(html).toContain('href="https://club.example.org/sign-in"');
  });

  it("tell a rejected person kindly, with no button", async () => {
    const m = rejectedForInvitee("Green Valley", "Grace");
    const { html } = await renderEmail(brand, m.content);
    expect(html).toContain("did not approve");
    expect(html).not.toMatch(/<a [^>]*href/i);
  });

  it("take the instance name from the caller, never from fixed text", () => {
    for (const name of ["Green Valley", "Birch Club"]) {
      const all = [pendingForAdmin(name, who, null), approvedForInvitee(name, "Grace", null), rejectedForInvitee(name, "Grace")];
      for (const m of all) expect(JSON.stringify(m)).toContain(name);
    }
  });

  it("use no em dash and no line break in a subject", () => {
    const m = pendingForAdmin("Green\nValley", { ...who, name: "Grace\r\nBcc: x" }, null);
    expect(m.subject).not.toMatch(/[\r\n]/);
    for (const msg of [m, approvedForInvitee("A", "B", null), rejectedForInvitee("A", "B")]) {
      expect(JSON.stringify(msg)).not.toContain("—");
    }
  });
});

describe("siteUrl", () => {
  it("joins a path to the site address and refuses anything that is not http or https", () => {
    expect(siteUrl("https://club.example.org", "/sign-in")).toBe("https://club.example.org/sign-in");
    expect(siteUrl("https://club.example.org/some/path", "/sign-in")).toBe("https://club.example.org/sign-in");
    expect(siteUrl(undefined, "/sign-in")).toBeNull();
    expect(siteUrl("javascript:alert(1)", "/sign-in")).toBeNull();
    expect(siteUrl("not a url", "/sign-in")).toBeNull();
  });
});
