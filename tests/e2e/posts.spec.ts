import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";

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

  // Deleting lives in the "..." menu on my own post, and it asks first.
  await card.getByRole("button", { name: "More options" }).click();
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
  // Not even the "..." menu: there is nothing in it for someone else's post.
  await expect(card.getByRole("button", { name: "More options" })).toHaveCount(0);
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
