import { describe, expect, it } from "vitest";
import { isKlipyMediaUrl } from "@/lib/gif";
import { extractEntities } from "@/lib/post-entities";
import { firstLink } from "@/lib/post-links";
import { checkPostText } from "@/lib/post-text";
import { validateUsername } from "@/lib/username";
import { checkLinkCard } from "@/links/card";
import { sniffImage } from "@/storage/images";
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD, FOLLOW_ADMIN, GIFS, ITEMS, PEOPLE, PRIVATE_APPROVED, PRIVATE_WAITING } from "../../scripts/demo/data";
import { SCENES, scenePicture } from "../../scripts/demo/pictures";

const names = new Set(PEOPLE.map((p) => p.username));
const privateNames = new Set(PEOPLE.filter((p) => p.private).map((p) => p.username));
// Interface text has no emoji and no em dashes (CLAUDE.md); the demo posts keep to the same plain style.
const FANCY = /[—–\p{Extended_Pictographic}]/u;

describe("the demo people", () => {
  it("are 10 to 15, each with a valid username, a short bio and a distinct email", () => {
    expect(PEOPLE.length).toBeGreaterThanOrEqual(10);
    expect(PEOPLE.length).toBeLessThanOrEqual(15);
    expect(names.size).toBe(PEOPLE.length);
    for (const p of PEOPLE) {
      expect(validateUsername(p.username, { instanceName: "Netmate" }).ok, p.username).toBe(true);
      expect(p.bio.length).toBeLessThanOrEqual(160);
      expect(p.bio).not.toMatch(FANCY);
      expect(`${p.username}@${DEMO_EMAIL_DOMAIN}`).toMatch(/^[a-z0-9_]+@[a-z.]+$/);
    }
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });

  it("include one private account, with a guest list of real people and one request still waiting", () => {
    expect(privateNames.size).toBe(1);
    for (const n of [...PRIVATE_APPROVED, ...PRIVATE_WAITING, ...FOLLOW_ADMIN]) expect(names.has(n), n).toBe(true);
    for (const n of PRIVATE_WAITING) expect(PRIVATE_APPROVED).not.toContain(n);
  });
});

describe("the demo posts", () => {
  const seen = new Set<string>();
  const authorOf = new Map<string, string>();
  const parts = { tags: 0, mentions: 0, pics: new Set<number>(), gifs: 0, quotes: 0, replies: 0, places: 0, links: 0, reposts: 0, likes: 0, saves: 0, privateAuthor: 0 };

  it("every one is valid text, from a real person, and points only at earlier posts", () => {
    for (const item of ITEMS) {
      const text = item.text.replaceAll("{admin}", "boss");
      const checked = checkPostText(text);
      expect(checked.ok, text).toBe(true);
      expect(text).not.toMatch(FANCY);
      expect(names.has(item.as), item.as).toBe(true);
      for (const n of [...(item.likes ?? []), ...(item.saves ?? []), ...(item.reposts ?? [])]) expect(names.has(n), n).toBe(true);

      const target = item.reply && item.reply !== "admin" ? item.reply : item.quote;
      if (target) {
        expect(seen.has(target), `"${target}" must come first`).toBe(true);
        // A private account's posts can be neither reposted nor quoted, so nobody quotes or reposts one.
        if (item.quote) expect(privateNames.has(authorOf.get(target)!), "a quote of a private post").toBe(false);
      }
      for (const who of item.reposts ?? []) expect(privateNames.has(item.as), `${who} reposting a private post`).toBe(false);
      if (item.id) {
        expect(seen.has(item.id), `duplicate id ${item.id}`).toBe(false);
        seen.add(item.id);
        authorOf.set(item.id, item.as);
      }

      // Pictures, a GIF and a card: pictures and a GIF never together; a card never with pictures, a GIF or a quote.
      expect((item.pics ?? []).length).toBeLessThanOrEqual(4);
      expect(!!item.pics?.length && !!item.gif).toBe(false);
      if (item.link) {
        expect(item.pics?.length ?? 0).toBe(0);
        expect(item.gif).toBeUndefined();
        expect(item.quote).toBeUndefined();
        const card = checkLinkCard(item.link);
        expect(card, text).not.toBeNull();
        expect(firstLink(text)).toBe(card!.url);
      }
      for (const n of extractEntities(text).mentions) expect(names.has(n) || n === "boss", `@${n}`).toBe(true);

      const entities = extractEntities(text);
      if (entities.tags.length > 0) parts.tags++;
      if (entities.mentions.length > 0) parts.mentions++;
      if (item.pics?.length) parts.pics.add(item.pics.length);
      if (item.gif) parts.gifs++;
      if (item.quote) parts.quotes++;
      if (item.reply) parts.replies++;
      if (item.place) parts.places++;
      if (item.link) parts.links++;
      parts.reposts += item.reposts?.length ?? 0;
      parts.likes += item.likes?.length ?? 0;
      parts.saves += item.saves?.length ?? 0;
      if (privateNames.has(item.as)) parts.privateAuthor++;
    }
  });

  it("show every kind of post at least once, and every account posts a few times", () => {
    expect(parts.tags).toBeGreaterThan(5);
    expect(parts.mentions).toBeGreaterThan(2);
    expect([...parts.pics].sort()).toEqual([1, 2, 3, 4]);
    expect(parts.gifs).toBeGreaterThan(2);
    expect(parts.quotes).toBeGreaterThan(2);
    expect(parts.replies).toBeGreaterThan(5);
    expect(parts.places).toBeGreaterThan(2);
    expect(parts.links).toBeGreaterThan(2);
    expect(parts.reposts).toBeGreaterThan(5);
    expect(parts.likes).toBeGreaterThan(50);
    expect(parts.saves).toBeGreaterThan(5);
    expect(parts.privateAuthor).toBeGreaterThan(1);
    for (const p of PEOPLE) expect(ITEMS.filter((i) => i.as === p.username).length, p.username).toBeGreaterThanOrEqual(3);
  });

  it("use GIF addresses that the app itself would accept", () => {
    for (const [key, gif] of Object.entries(GIFS)) {
      expect(isKlipyMediaUrl(gif.url), key).toBe(true);
      expect(gif.title.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("the demo pictures", () => {
  it("are real PNG files, small, and the same every time", () => {
    for (const scene of SCENES) {
      const a = scenePicture(scene, 3);
      expect(sniffImage(new Uint8Array(a.subarray(0, 12)))).toBe("png");
      expect(a.length).toBeLessThan(400 * 1024);
      expect(scenePicture(scene, 3).equals(a)).toBe(true);
    }
  });

  it("change with the palette number", () => {
    expect(scenePicture("hills", 0).equals(scenePicture("hills", 1))).toBe(false);
  });
});
