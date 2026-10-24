import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";
import { solidPng } from "./png";

// Serial: later tests use the posts made by earlier ones.
test.describe.configure({ mode: "serial" });

/** This test's own post, found by its unique text (other tests post in parallel). */
const mine = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

const unique = () => `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function writePost(page: Page, text: string) {
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(text);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("writing a post puts it at the top of Home with my name and a short time", async ({ page }) => {
  const text = unique();
  await writePost(page, text);

  const first = mine(page, text);
  await expect(first).toContainText(text);
  await expect(first).toContainText(`${E2E.admin.firstName} ${E2E.admin.lastName}`);
  await expect(first).toContainText(`@${E2E.admin.username}`);
  await expect(first.locator("time")).toHaveText("now");
});

test("the composer counts down, blocks an empty or over-long post, and fits the phone", async ({ page }) => {
  await page.goto("/compose");
  const post = page.getByRole("button", { name: "Post", exact: true });
  await expect(post).toBeDisabled();

  await page.getByLabel("Your post").fill("a".repeat(270));
  await expect(page.getByRole("status")).toContainText("10");
  await expect(post).toBeEnabled();

  await page.getByLabel("Your post").fill("a".repeat(281));
  await expect(page.getByRole("status")).toContainText("-1");
  await expect(post).toBeDisabled();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("post text is shown as text, never run as markup", async ({ page }) => {
  const text = `${unique()} <b>bold</b> <img src=x onerror="window.__pwned=1">`;
  await writePost(page, text);

  await expect(mine(page, "<b>bold</b>").first()).toContainText("<b>bold</b>");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(mine(page, "<b>bold</b>").first().locator("b")).toHaveCount(0);
});

test("liking is a toggle that keeps its count after a reload", async ({ page }) => {
  const text = unique();
  await writePost(page, text);
  const card = mine(page, text);

  await card.getByRole("button", { name: /^Like,/ }).click();
  // The heart changes at once; the button is enabled again only when the server has answered.
  await expect(card.getByRole("button", { name: /^Unlike, 1 likes/ })).toBeEnabled();
  await page.reload();
  await expect(mine(page, text).getByRole("button", { name: /^Unlike, 1 likes/ })).toBeVisible();

  await mine(page, text).getByRole("button", { name: /^Unlike,/ }).click();
  await expect(mine(page, text).getByRole("button", { name: /^Like, 0 likes/ })).toBeEnabled();
});

test("replying from the post page shows the reply there and raises the count on Home", async ({ page }) => {
  const text = unique();
  await writePost(page, text);
  await mine(page, text).getByRole("link", { name: /^Reply,/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}/status/post_`));

  const reply = unique();
  await page.getByLabel("Your reply").fill(reply);
  await page.getByRole("button", { name: "Reply", exact: true }).click();

  await expect(page.getByRole("region", { name: "Replies", exact: true })).toContainText(reply);
  await page.goto("/");
  const card = page.getByRole("article").filter({ hasText: text });
  await expect(card.getByRole("link", { name: /^Reply, 1 replies/ })).toBeVisible();
  // The reply itself is not a Home post.
  await expect(page.getByRole("article").filter({ hasText: reply })).toHaveCount(0);
});

test("deleting my own post asks first and removes it everywhere", async ({ page }) => {
  const text = unique();
  await writePost(page, text);
  const card = page.getByRole("article").filter({ hasText: text });

  // Deleting lives in the "..." menu on my own post, and it asks first. The old bin icon is gone from the row.
  const more = card.getByRole("button", { name: "More options" });
  const moreBox = (await more.boundingBox())!;
  expect(moreBox.width).toBeGreaterThanOrEqual(44);
  expect(moreBox.height).toBeGreaterThanOrEqual(44);
  await expect(card.getByRole("button", { name: "Delete post" })).toHaveCount(0);

  // The menu opens inside the phone, and closes with Escape or a tap anywhere outside it.
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const item = card.getByRole("button", { name: "Delete post" });
  const itemBox = (await item.boundingBox())!;
  expect(itemBox.height).toBeGreaterThanOrEqual(44);
  expect(itemBox.x).toBeGreaterThanOrEqual(0);
  expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(item).toBeVisible();
  await page.mouse.click(200, 10);
  await expect(item).toHaveCount(0);

  await more.click();
  await card.getByRole("button", { name: "Delete post" }).click();
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete post" })).toHaveCount(0);

  await card.getByRole("button", { name: "More options" }).click();
  await card.getByRole("button", { name: "Delete post" }).click();
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: text })).toHaveCount(0);
});

test("another member sees my post, and cannot delete it", async ({ browser, page }) => {
  const text = unique();
  await writePost(page, text);

  const other = await signUpMember(browser, "198.18.9.9");
  await other.page.goto("/");
  const card = other.page.getByRole("article").filter({ hasText: text });
  await expect(card).toBeVisible();
  // Someone else's post has a "..." menu with Report post in it, and never Delete post.
  await card.getByRole("button", { name: "More options" }).click();
  await expect(card.getByRole("link", { name: "Report post" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete post" })).toHaveCount(0);
  await other.context.close();
});

test("a missing post and a wrong username are both a plain not found", async ({ page }) => {
  const missing = await page.goto(`/${E2E.admin.username}/status/post_${"a".repeat(24)}`);
  expect(missing?.status()).toBe(404);

  const text = unique();
  await writePost(page, text);
  const href = await mine(page, text).getByRole("link", { name: /^Reply,/ }).getAttribute("href");
  const wrong = await page.goto(href!.replace(E2E.admin.username, "someone_else"));
  expect(wrong?.status()).toBe(404);
});

test("a signed-out visitor is sent to sign in from the compose page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/compose");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});

const pic = (name: string, shade: number) => ({ name, mimeType: "image/png", buffer: solidPng(48, 32, [shade, 110, 79]) });

test("a post can carry pictures, with words or without, and they stay after a reload", async ({ page }) => {
  await page.goto("/compose");
  const post = page.getByRole("button", { name: "Post", exact: true });
  await expect(post).toBeDisabled();

  await page.locator('input[type="file"]').setInputFiles([pic("a.png", 20), pic("b.png", 90)]);
  await expect(page.getByRole("img", { name: "Picture 2" })).toBeVisible();
  await expect(page.getByText("Uploading")).toHaveCount(0);
  // Pictures alone are enough to post.
  await expect(post).toBeEnabled();

  const text = unique();
  await page.getByLabel("Your post").fill(text);
  await post.click();
  await expect(page).toHaveURL(/\/$/);

  const card = mine(page, text);
  await expect(card.locator(".post-photos img")).toHaveCount(2);
  // The pictures load lazily, so give them a moment to arrive.
  await expect
    .poll(() => card.locator(".post-photos img").evaluateAll((all) => all.map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toEqual([true, true]);

  await page.reload();
  await expect(mine(page, text).locator(".post-photos img")).toHaveCount(2);
  // The picture opens in full from its own address, served as an image.
  const href = await mine(page, text).locator(".post-photos a").first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a post with only a picture shows no text, and four is the most", async ({ page }) => {
  await page.goto("/compose");
  await page.locator('input[type="file"]').setInputFiles([pic("1.png", 10), pic("2.png", 20), pic("3.png", 30), pic("4.png", 40), pic("5.png", 50)]);
  await expect(page.getByRole("img", { name: /^Picture \d$/ })).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^Add pictures/ })).toBeDisabled();

  await page.getByRole("button", { name: "Remove picture 4" }).click();
  await page.getByRole("button", { name: "Remove picture 3" }).click();
  await page.getByRole("button", { name: "Remove picture 2" }).click();
  await expect(page.getByRole("img", { name: /^Picture \d$/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add pictures" })).toBeEnabled();

  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const first = page.getByRole("article").first();
  await expect(first.locator(".post-photos img")).toHaveCount(1);
  await expect(first.locator(".post-body")).toHaveCount(0);
});

test("a file that is not a picture is refused and blocks the post until removed", async ({ page }) => {
  await page.goto("/compose");
  await page.locator('input[type="file"]').setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await expect(page.getByRole("alert").filter({ hasText: "JPEG, PNG, WebP or GIF" })).toBeVisible();
  await page.getByLabel("Your post").fill(unique());
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Remove picture 1" }).click();
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
});
