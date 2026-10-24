import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";

// Writes nothing: it only types into the composer and never presses Post, so it can run anywhere in the suite.

const box = (page: Page) => page.getByLabel("Your post");
const live = (page: Page) => page.locator(".composer-backdrop .live-entity");
const people = [
  { userId: "usr_aaaaaaaaaaaaaaaaaaaaaaaa", username: "maya_r", firstName: "Maya", lastName: "Rao", avatarKey: null },
  { userId: "usr_bbbbbbbbbbbbbbbbbbbbbbbb", username: "mason", firstName: "Mason", lastName: "Lee", avatarKey: null },
];

/** Answers the name lookups with fixed people (no other member exists yet at this point in the suite). */
async function stubNames(page: Page, real: string[] = []) {
  const asked: string[] = [];
  await page.route("**/api/mentions?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    if (url.searchParams.has("names")) return route.fulfill({ json: { names: real } });
    const q = url.searchParams.get("q") ?? "";
    return route.fulfill({ json: { people: people.filter((p) => p.username.startsWith(q)) } });
  });
  return asked;
}

test("tags and names change colour as they are typed, while the box keeps working", async ({ page }) => {
  await page.goto("/compose");
  const text = "Morning #Coffee with @riya_sen and @ab, plus # alone and a#b and me@example.com";
  await box(page).fill(text);

  // Only what will become a link is coloured: the tag, and the name that has a username's shape.
  await expect(live(page)).toHaveText(["#Coffee", "@riya_sen"]);
  const colours = await page.evaluate(() => {
    const part = document.querySelector(".composer-backdrop .live-entity")!;
    const plain = document.querySelector(".composer-backdrop")!;
    const typed = document.querySelector("textarea.composer-text")!;
    return { part: getComputedStyle(part).color, plain: getComputedStyle(plain).color, typed: getComputedStyle(typed).color };
  });
  expect(colours.part).not.toBe(colours.plain);
  // The box itself shows no text of its own (the copy does), yet what was typed is what is in it.
  expect(colours.typed).toBe("rgba(0, 0, 0, 0)");
  expect(await box(page).inputValue()).toBe(text);

  // The copy says exactly what the box says.
  expect(await page.locator(".composer-backdrop").evaluate((el) => (el.textContent ?? "").replace("​", ""))).toBe(text);

  // Typing more keeps up; deleting the tag takes the colour away.
  await box(page).fill("plain words only");
  await expect(live(page)).toHaveCount(0);
  await box(page).pressSequentially(" #fresh");
  await expect(live(page)).toHaveText(["#fresh"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the coloured copy wraps and scrolls exactly like the box", async ({ page }) => {
  await page.goto("/compose");
  // A real name on every line (the admin), and a new tag on every line.
  const long = Array.from({ length: 40 }, (_, i) => `line ${i} with #tag${i} and @${E2E.admin.username}`).join("\n");
  await box(page).fill(long);
  // The first ten tags are coloured and the rest are not (the server keeps ten); the one real name is coloured every time.
  await expect(live(page)).toHaveCount(10 + 40);

  const sizes = await page.evaluate(() => {
    const area = document.querySelector("textarea.composer-text")! as HTMLTextAreaElement;
    const copy = document.querySelector(".composer-backdrop")! as HTMLElement;
    area.scrollTop = 120;
    area.dispatchEvent(new Event("scroll"));
    return { area: area.scrollHeight, copy: copy.scrollHeight, areaTop: area.scrollTop, copyTop: copy.scrollTop };
  });
  expect(Math.abs(sizes.area - sizes.copy)).toBeLessThanOrEqual(2);
  expect(sizes.copyTop).toBe(sizes.areaTop);
});

test("a name nobody has stops being coloured once the server has said so", async ({ page }) => {
  await stubNames(page, ["maya_r"]);
  await page.goto("/compose");
  await box(page).fill("hi @maya_r and @nobodyhere");
  await expect(live(page)).toHaveText(["@maya_r"]);
});

test("typing @ lists people, the keyboard and a tap pick one, and nothing is posted by Enter", async ({ page }) => {
  const asked = await stubNames(page, ["maya_r", "mason"]);
  await page.goto("/compose");
  const url = page.url();

  await box(page).fill("hello @ma");
  const list = page.getByRole("listbox", { name: "People" });
  const options = list.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("Maya Rao");
  await expect(options.nth(0)).toContainText("@maya_r");
  for (const option of await options.all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

  // Down, then Enter: the second person goes in, with a space after, and the list closes.
  await box(page).press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await box(page).press("Enter");
  await expect(box(page)).toHaveValue("hello @mason ");
  await expect(list).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(live(page)).toHaveText(["@mason"]);

  // A tap picks too, in the middle of a line.
  await box(page).fill("one @ma two");
  // Move the cursor with the keyboard to just after "@ma".
  await box(page).press("Home");
  for (let i = 0; i < 7; i++) await box(page).press("ArrowRight");
  await expect(options).toHaveCount(2);
  await options.nth(0).dispatchEvent("pointerdown");
  await expect(box(page)).toHaveValue("one @maya_r  two");

  // Escape closes the list and keeps what was typed.
  await box(page).fill("again @ma");
  await expect(options).toHaveCount(2);
  await box(page).press("Escape");
  await expect(list).toHaveCount(0);
  await expect(box(page)).toHaveValue("again @ma");
  expect(asked.some((s) => s.includes("q=ma"))).toBe(true);
});

test("no list for what is not a name: an email, a web address, or a finished name", async ({ page }) => {
  await stubNames(page, []);
  await page.goto("/compose");
  const list = page.getByRole("listbox", { name: "People" });
  for (const text of ["write me@ma", "see https://example.com/@ma", "hello @maya_r and"]) {
    await box(page).fill(text);
    await page.waitForTimeout(400);
    await expect(list).toHaveCount(0);
  }
  // A bare @ asks for the people you follow, and the list shows what the answer holds.
  await box(page).fill("hello @");
  await expect(list.getByRole("option")).toHaveCount(2);
});

test("the name lookups need a signed-in member on this site, and give only what a mention needs", async ({ page, browser }) => {
  const own = await page.request.get("/api/mentions?q=");
  expect(own.status()).toBe(200);
  const body = (await own.json()) as { people: Record<string, unknown>[] };
  // The admin is never suggested to themselves; every entry has only the six fields a link needs.
  expect(body.people.some((p) => p.username === E2E.admin.username)).toBe(false);
  for (const person of body.people) expect(Object.keys(person).sort()).toEqual(["avatarKey", "firstName", "iFollow", "lastName", "userId", "username"]);
  expect(own.headers()["cache-control"]).toContain("no-store");

  // The check includes yourself, since your own name still links.
  const names = await page.request.get(`/api/mentions?names=${E2E.admin.username},nobody_here`);
  expect(await names.json()).toEqual({ names: [E2E.admin.username] });

  // Another site cannot spend the member's lookups.
  const cross = await page.request.get("/api/mentions?q=a", { headers: { "sec-fetch-site": "cross-site" } });
  expect(cross.status()).toBe(403);

  // Signed out: nothing.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const signedOut = await context.request.get("/api/mentions?q=a");
  expect(signedOut.status()).toBe(401);
  await context.close();
});
