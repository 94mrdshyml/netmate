import { describe, expect, it } from "vitest";
import type { LinkCard } from "@/links/fetch";
import { CARD_TOKEN_LIFETIME_MS, signLinkCard, verifyLinkCard } from "@/links/token";

const SECRET = ["a", "test", "secret", "long", "enough"].join("-");
const card: LinkCard = { url: "https://example.com/a", title: "Title", description: "About", image: "https://cdn.example.com/p.png", site: "example.com" };
const NOW = 1_800_000_000_000;

describe("signLinkCard and verifyLinkCard", () => {
  it("gives back the card for the same member within half an hour", async () => {
    const token = await signLinkCard(card, "usr_one", SECRET, NOW);
    expect(await verifyLinkCard(token, "usr_one", SECRET, NOW + 1000)).toEqual(card);
    expect(await verifyLinkCard(token, "usr_one", SECRET, NOW + CARD_TOKEN_LIFETIME_MS)).toEqual(card);
  });

  it("refuses it after half an hour, for another member, or with another secret", async () => {
    const token = await signLinkCard(card, "usr_one", SECRET, NOW);
    expect(await verifyLinkCard(token, "usr_one", SECRET, NOW + CARD_TOKEN_LIFETIME_MS + 1)).toBeNull();
    expect(await verifyLinkCard(token, "usr_two", SECRET, NOW)).toBeNull();
    expect(await verifyLinkCard(token, "usr_one", `${SECRET}-other`, NOW)).toBeNull();
  });

  it("refuses a card whose text was changed, even with the old signature", async () => {
    const token = await signLinkCard(card, "usr_one", SECRET, NOW);
    const [, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ c: { ...card, title: "Send money to me" }, u: "usr_one", e: NOW + 60_000 })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(await verifyLinkCard(`${forged}.${signature}`, "usr_one", SECRET, NOW)).toBeNull();
    // Flipping one character of the signature also fails.
    const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await verifyLinkCard(flipped, "usr_one", SECRET, NOW)).toBeNull();
  });

  it.each([undefined, null, 5, {}, [], "", "abc", "a.b.c", ".", "x.", ".y", "not base64!.also not", "a".repeat(5000)])("refuses %j", async (junk) => {
    expect(await verifyLinkCard(junk, "usr_one", SECRET, NOW)).toBeNull();
  });
});
