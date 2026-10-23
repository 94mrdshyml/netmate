import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "./constants";

// Serial: later tests use the posts made by earlier ones.
test.describe.configure({ mode: "serial" });

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

  const first = page.getByRole("article").first();
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

  await expect(page.getByRole("article").first()).toContainText("<b>bold</b>");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.getByRole("article").first().locator("b")).toHaveCount(0);
});

test("liking is a toggle that keeps its count after a reload", async ({ page }) => {
  await writePost(page, unique());
  const card = page.getByRole("article").first();

  await card.getByRole("button", { name: /^Like,/ }).click();
  await expect(card.getByRole("button", { name: /^Unlike, 1 likes/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article").first().getByRole("button", { name: /^Unlike, 1 likes/ })).toBeVisible();

  await page.getByRole("article").first().getByRole("button", { name: /^Unlike,/ }).click();
  await expect(page.getByRole("article").first().getByRole("button", { name: /^Like, 0 likes/ })).toBeVisible();
});

test("replying from the post page shows the reply there and raises the count on Home", async ({ page }) => {
  const text = unique();
  await writePost(page, text);
  await page.getByRole("article").first().getByRole("link", { name: /^Reply,/ }).click();
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

  await card.getByRole("button", { name: "Delete post" }).click();
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Delete post" }).click();
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: text })).toHaveCount(0);
});

test("another member sees my post, and cannot delete it", async ({ browser, page }) => {
  const text = unique();
  await writePost(page, text);

  const other = await signUpMember(browser);
  await other.page.goto("/");
  const card = other.page.getByRole("article").filter({ hasText: text });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete post" })).toHaveCount(0);
  await other.context.close();
});

test("a missing post and a wrong username are both a plain not found", async ({ page }) => {
  const missing = await page.goto(`/${E2E.admin.username}/status/post_${"a".repeat(24)}`);
  expect(missing?.status()).toBe(404);

  await writePost(page, unique());
  const href = await page.getByRole("article").first().getByRole("link", { name: /^Reply,/ }).getAttribute("href");
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

/** A second member, joined through the admin's link from an address of their own. */
async function signUpMember(browser: Browser) {
  const adminContext = await browser.newContext({ storageState: E2E.authFile });
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/");
  const link = await adminPage.getByLabel("Your invite link").inputValue();
  await adminContext.close();

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": "198.18.9.9" },
  });
  const page = await context.newPage();
  await page.goto(link);
  const stamp = Date.now().toString(36);
  await page.getByLabel("First name").fill("Other");
  await page.getByLabel("Last name").fill("Member");
  await page.getByLabel("Email").fill(`other-${stamp}@example.com`);
  await page.getByLabel("Username").fill(`oth_${stamp.slice(-8)}`);
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { page, context };
}
