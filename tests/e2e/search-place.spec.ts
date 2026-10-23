import { expect, test, type Page } from "@playwright/test";
import { sendPost } from "./helpers";

// Serial: each test uses the state the one before left. Only two admin posts are made (posts.spec
// sends the admin's 10 posts a minute in one burst, so `sendPost` waits out the limit if they land
// near it), and no member is signed up (the sign-up budget is used up, see session 33).
test.describe.configure({ mode: "serial" });

const unique = () => `place ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const card = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

async function openPicker(page: Page) {
  await page.goto("/compose");
  await page.getByRole("button", { name: "Add a place" }).click();
  return page.getByRole("combobox", { name: "Where was this?" });
}

test("with place suggestions off (the default) there is no pin on the composer and no suggestions", async ({ page }) => {
  await page.goto("/compose");
  await expect(page.getByLabel("Your post")).toBeVisible();
  await expect(page.getByRole("button", { name: /place/i })).toHaveCount(0);
  const res = await page.request.get("/api/places?q=berlin");
  expect(res.status()).toBe(404);
});

test("the admin turns place suggestions on from Services, and it stays on", async ({ page }) => {
  await page.goto("/hq");
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Services" }).click();
  await expect(page).toHaveURL(/\/hq\/services$/);
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByText("never your members' phones")).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Suggest places" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("status").filter({ hasText: "Place suggestions are on." })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: "Suggest places" })).toHaveAttribute("aria-checked", "true");
});

test("typing in the place box suggests places, and a chosen place goes on the post", async ({ page }) => {
  const box = await openPicker(page);
  await expect(box).toBeFocused();

  // One letter is too little to ask about.
  await box.fill("b");
  await expect(page.getByRole("listbox", { name: "Places" })).toHaveCount(0);

  await box.fill("ber");
  const options = page.getByRole("listbox", { name: "Places" }).getByRole("option");
  await expect(options.nth(0)).toHaveText("Berlin, Germany");
  await expect(options.nth(1)).toHaveText("Bergen, Norway");
  await expect(options.nth(2)).toHaveText('Use "ber"');
  // Every suggestion is easy to hit.
  for (const option of await options.all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // The keyboard works: down, then Enter, picks it without posting the form.
  await box.press("ArrowDown");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/compose$/);
  await expect(page.getByRole("combobox", { name: "Where was this?" })).toHaveCount(0);
  const tag = page.locator(".composer-place");
  await expect(tag).toContainText("Berlin, Germany");
  await expect(page.getByRole("button", { name: "Change place" })).toBeVisible();

  const text = unique();
  await page.getByLabel("Your post").fill(text);
  await sendPost(page);
  await expect(card(page, text).locator(".post-place")).toHaveText("Berlin, Germany");

  // On the post's own page, and after a reload, still there.
  await card(page, text).getByRole("link", { name: /^Reply/ }).click();
  await expect(page).toHaveURL(/\/status\/post_/);
  await expect(card(page, text).locator(".post-place")).toHaveText("Berlin, Germany");
  await page.reload();
  await expect(card(page, text).locator(".post-place")).toHaveText("Berlin, Germany");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a place can be typed when suggestions are down, is taken off with its x, and is cut at 60 characters", async ({ page }) => {
  const box = await openPicker(page);

  // Pretend Photon is down: the member is told, and can still use what they typed.
  await box.fill("offline");
  await expect(page.getByText("Suggestions are not available right now. You can type the place yourself.")).toBeVisible();
  await box.press("Enter");
  const tag = page.locator(".composer-place");
  await expect(tag).toContainText("offline");

  await page.getByRole("button", { name: "Remove place offline" }).click();
  await expect(tag).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a place" })).toBeVisible();

  // Too long is said plainly and cannot be chosen.
  await page.getByRole("button", { name: "Add a place" }).click();
  await page.getByRole("combobox", { name: "Where was this?" }).fill("x".repeat(70));
  await expect(page.getByText("Use 60 characters or fewer.")).toBeVisible();
  await page.getByRole("combobox", { name: "Where was this?" }).press("Enter");
  await expect(page.locator(".composer-place")).toHaveCount(0);

  // A place of one's own words goes on the post like any other.
  await page.getByRole("combobox", { name: "Where was this?" }).fill("Grandma's kitchen");
  await page.getByRole("option", { name: 'Use "Grandma\'s kitchen"' }).click();
  await expect(page.locator(".composer-place")).toContainText("Grandma's kitchen");
  const text = unique();
  await page.getByLabel("Your post").fill(text);
  await sendPost(page);
  await expect(card(page, text).locator(".post-place")).toHaveText("Grandma's kitchen");
});

test("the place box fits a phone, closes with Escape, and a reply has no pin", async ({ page }) => {
  const box = await openPicker(page);
  await box.fill("ber");
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await box.press("Escape");
  await expect(page.getByRole("combobox", { name: "Where was this?" })).toHaveCount(0);

  // Replies are about the post above them, so only a new post gets a place.
  await page.goto("/");
  await page.getByRole("article").first().getByRole("link", { name: /^Reply/ }).click();
  await expect(page.getByPlaceholder("Write your reply")).toBeVisible();
  await expect(page.getByRole("button", { name: /place/i })).toHaveCount(0);
});

test("suggestions need a signed-in member, and turning the setting off hides the pin but keeps the posts' places", async ({ page, browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anonymous.request.get("/api/places?q=berlin")).status()).toBe(401);
  await anonymous.close();

  await page.goto("/hq/services");
  const toggle = page.getByRole("switch", { name: "Suggest places" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("status").filter({ hasText: "Place suggestions are off." })).toBeVisible();

  await page.goto("/compose");
  await expect(page.getByLabel("Your post")).toBeVisible();
  await expect(page.getByRole("button", { name: /place/i })).toHaveCount(0);
  expect((await page.request.get("/api/places?q=berlin")).status()).toBe(404);

  // Places already on posts stay.
  await page.goto("/");
  await expect(page.locator(".post-place").filter({ hasText: "Berlin, Germany" }).first()).toBeVisible();
});
