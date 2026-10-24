import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sendPost } from "./helpers";
import { solidPng } from "./png";

// Serial: each test uses the state the one before left. Named so it runs after posts.spec (which sends
// exactly 10 admin posts a minute in a burst). Only two admin posts are made and nobody is signed up
// (the sign-up budget is used up, see session 33). Reposting and saving are done to the admin's own posts.
test.describe.configure({ mode: "serial" });

const unique = () => `share ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const card = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

const pic = (name: string, shade: number) => ({ name, mimeType: "image/png", buffer: solidPng(48, 32, [shade, 110, 79]) });

let original = "";
let quoteText = "";

test("a post can be reposted and the repost taken back, and the feed says 'You reposted'", async ({ page }) => {
  original = unique();
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(original);
  // The original has a picture, so the quote card of it later shows one.
  await page.locator('input[type="file"]').setInputFiles(pic("original.png", 30));
  await expect(page.getByRole("img", { name: "Picture 1" })).toBeVisible();
  await sendPost(page);

  const mine = card(page, original).first();
  const repost = mine.getByRole("button", { name: /^Repost, 0 times/ });
  expect((await repost.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await repost.click();
  // The sheet offers Repost and Quote, each easy to hit.
  const sheet = page.getByRole("menu", { name: "Repost" });
  for (const item of await sheet.getByRole("menuitem").all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await sheet.getByRole("menuitem", { name: "Repost" }).click();
  await expect(mine.getByRole("button", { name: /^Repost, 1 time/ })).toHaveAttribute("aria-pressed", "true");

  // Doing it again from a fresh page still says "reposted": the server kept it.
  const reposted = page.locator("article").filter({ has: page.getByText("You reposted") }).filter({ hasText: original });
  // The button changes at once and the server finishes a moment later, so look again until it has.
  await expect(async () => {
    await page.goto("/?feed=following");
    await expect(reposted).toHaveCount(1, { timeout: 2000 });
  }).toPass();
  await expect(reposted.getByRole("button", { name: /^Repost, 1 time/ })).toHaveAttribute("aria-pressed", "true");
  // The same post is also there as itself, so it appears twice.
  await expect(card(page, original)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // Take it back: the count and the extra copy go.
  await reposted.getByRole("button", { name: /^Repost, 1 time/ }).click();
  await page.getByRole("menu", { name: "Repost" }).getByRole("menuitem", { name: "Undo repost" }).click();
  await expect(reposted.getByRole("button", { name: /^Repost, 0 times/ })).toBeVisible();
  // The button changes at once and the server finishes a moment later, so look again until it has.
  await expect(async () => {
    await page.reload();
    await expect(card(page, original)).toHaveCount(1, { timeout: 2000 });
  }).toPass();
  await expect(page.getByText("You reposted")).toHaveCount(0);
});

test("Quote opens the composer with the original under it, and the quote shows its card", async ({ page }) => {
  await page.goto("/?feed=following");
  await card(page, original).first().getByRole("button", { name: /^Repost,/ }).click();
  await page.getByRole("menu", { name: "Repost" }).getByRole("menuitem", { name: "Quote" }).click();
  await expect(page).toHaveURL(/\/compose\?quote=post_/);
  await expect(page.getByRole("heading", { name: "Quote post" })).toBeVisible();

  // The original sits under the text, not as a link, with its picture. A quote can have pictures of its own.
  const quoted = page.getByRole("group", { name: /^Quoting a post by/ });
  await expect(quoted).toContainText(original);
  await expect(quoted.getByRole("img", { name: "Picture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add pictures" })).toBeEnabled();

  // A quote does not need words of its own: the Post button is ready now.
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  quoteText = unique();
  await page.getByLabel("Your post").fill(quoteText);
  await page.locator('input[type="file"]').setInputFiles(pic("mine.png", 90));
  await expect(page.getByRole("img", { name: "Picture 1", exact: true })).toBeVisible();
  await sendPost(page);

  const mine = card(page, quoteText);
  // Its own picture is in the post, and the original's picture is small inside the card.
  await expect(mine.locator(".post-photos img")).toHaveCount(1);
  const cardLink = mine.getByRole("link", { name: /^Quoted post by/ });
  await expect(cardLink).toContainText(original);
  const thumb = cardLink.locator(".quote-media img");
  await expect(thumb).toHaveCount(1);
  expect(await thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await cardLink.click();
  await expect(page).toHaveURL(/\/status\/post_/);
  await expect(card(page, original).first()).toBeVisible();

  // A quote link to a post that does not exist is simply not found.
  const missing = await page.goto("/compose?quote=post_aaaaaaaaaaaaaaaaaaaaaaaa");
  expect(missing?.status()).toBe(404);
});

test("saving a post is private: no count, a Saved posts list, and removing it empties the list", async ({ page }) => {
  await page.goto("/");
  const mine = card(page, quoteText).first();
  const save = mine.getByRole("button", { name: "Save post" });
  // The button shows no number, to the author or anyone.
  await expect(save).toHaveText("");
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.click();
  await expect(mine.getByRole("button", { name: "Remove from saved" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/settings");
  await page.getByRole("link", { name: /^Saved posts/ }).click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  await expect(page.getByRole("heading", { name: "Saved posts" })).toBeVisible();
  await expect(page.getByText("Only you can see this list.")).toBeVisible();
  const saved = card(page, quoteText);
  // The save may still be on its way to the server, so look again until it is listed.
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2000 });
  }).toPass();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await saved.getByRole("button", { name: "Remove from saved" }).click();
  await expect(saved.getByRole("button", { name: "Save post" })).toBeVisible();
  // The button changes at once and the server finishes a moment later, so look again until it has.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Nothing saved yet.")).toBeVisible({ timeout: 2000 });
  }).toPass();
});

test("a private account's posts have no repost button, even for its owner", async ({ page }) => {
  await page.goto("/privacy");
  const toggle = page.getByRole("switch", { name: "Private account" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // The switch moves at once; this line appears when the server has saved it.
  await expect(page.getByRole("status").filter({ hasText: "Your account is private." })).toBeVisible();
  try {
    await page.goto("/");
    const mine = card(page, original).first();
    await expect(mine).toBeVisible();
    await expect(mine.getByRole("button", { name: /^Repost,/ })).toHaveCount(0);
    // Saving is still fine: it is private to the reader.
    await expect(mine.getByRole("button", { name: "Save post" })).toBeVisible();
    // And the quote address for it is not found.
    const postHref = await mine.getByRole("link", { name: /^Reply/ }).getAttribute("href");
    const id = postHref!.split("/").pop();
    const res = await page.goto(`/compose?quote=${id}`);
    expect(res?.status()).toBe(404);
  } finally {
    await page.goto("/privacy");
    const back = page.getByRole("switch", { name: "Private account" });
    if ((await back.getAttribute("aria-checked")) === "true") {
      await back.click();
      await expect(page.getByRole("status").filter({ hasText: "Your account is public." })).toBeVisible();
    }
    await expect(back).toHaveAttribute("aria-checked", "false");
  }
});
