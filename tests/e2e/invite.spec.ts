import { expect, test, type Browser, type Page } from "@playwright/test";
import { openSignUpForm } from "./helpers";

// Serial: the second test uses a member made by the first.
test.describe.configure({ mode: "serial" });

async function fillSignUp(page: Page, n: number) {
  await page.getByLabel("First name").fill("Join");
  await page.getByLabel("Last name").fill(`Person${n}`);
  await page.getByLabel("Email").fill(`join${n}-${Date.now()}@example.com`);
  await page.getByLabel("Username").fill(`join_${n}_${Date.now().toString(36).slice(-5)}`);
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
}

// Each visitor gets its own address so the per-IP sign-up limit never trips across tests.
// (Locally there is no Cloudflare in front, so the header is ours to set.)
let nextVisitor = 0;

/**
 * A visitor with no session (the project's stored admin login is not inherited), who opens an
 * invite link. By default they go past the welcome screen to the form.
 */
async function visitor(browser: Browser, link: string, options: { form?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": `198.18.1.${++nextVisitor}` },
  });
  const page = await context.newPage();
  if (options.form === false) await page.goto(link);
  else await openSignUpForm(page, link);
  return { page, context };
}

let memberLink = "";

test("the admin has an invite link in Settings, and it works", async ({ page, browser }) => {
  await page.goto("/invite");
  const adminLink = await page.getByLabel("Your invite link").inputValue();
  expect(adminLink).toMatch(/\/sign-up\?invite=[0-9A-Za-z]{32}$/);

  const { page: guest, context } = await visitor(browser, adminLink);
  await expect(guest.getByRole("heading", { name: /^Join / })).toBeVisible();
  await expect(guest.getByText("invited you")).toBeVisible();
  await fillSignUp(guest, 1);

  // Auto-approved: signed in and on Home, with their own link.
  await expect(guest).toHaveURL(/\/$/);
  await expect(guest.getByRole("link", { name: "Profile" })).toHaveAttribute("href", /^\/join_1_/);
  await guest.goto("/invite");
  memberLink = await guest.getByLabel("Your invite link").inputValue();
  expect(memberLink).not.toBe(adminLink);
  await context.close();
});

test("a member's link approves the first five and holds the sixth for the admin", async ({ browser }) => {
  test.setTimeout(90_000);

  for (let n = 2; n <= 6; n++) {
    const { page, context } = await visitor(browser, memberLink);
    await fillSignUp(page, n);
    await expect(page).toHaveURL(/\/$/);
    await context.close();
  }

  const { page, context } = await visitor(browser, memberLink);
  await fillSignUp(page, 7);
  await expect(page).toHaveURL(/\/waiting$/);
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

  // And they cannot sign in until approved.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});

test("a wrong or missing link says so plainly", async ({ browser }) => {
  for (const path of ["/sign-up", `/sign-up?invite=${"z".repeat(32)}`]) {
    const { page, context } = await visitor(browser, path, { form: false });
    await expect(page.getByRole("heading", { name: "Invite link not valid" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await context.close();
  }
});

test("sign-up shows each problem and fits the phone column", async ({ browser }) => {
  const { page, context } = await visitor(browser, memberLink);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Enter your first name")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const width = await page.locator("main.column").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(480);
  await context.close();
});

test("an invite link opens a welcome first: who invited you, faces of members, and one way in", async ({ browser }) => {
  const { page, context } = await visitor(browser, memberLink, { form: false });

  // The instance and the inviter, from the database, not fixed text.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Join Person1 invited you to join");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Valley");

  // Two to four faces, the inviter named first in a friendly line, and no form yet.
  const faces = page.locator(".welcome-faces .avatar");
  expect(await faces.count()).toBeGreaterThanOrEqual(2);
  expect(await faces.count()).toBeLessThanOrEqual(4);
  await expect(page.locator(".welcome-people p")).toContainText(/^Join, .* (is|are) already here, saving you a seat\.$/);
  await expect(page.getByLabel("Password")).toHaveCount(0);

  // The button opens the form on the same link.
  await page.getByRole("link", { name: "Join E2E Valley" }).click();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page).toHaveURL(/join=1$/);
  await context.close();
});

test("the welcome fits a phone, keeps the buttons big enough to tap, and has no sideways scroll", async ({ browser }) => {
  const { page, context } = await visitor(browser, memberLink, { form: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const join = await page.getByRole("link", { name: /^Join / }).boundingBox();
  expect(join!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("link", { name: "Already a member? Sign in" })).toBeVisible();
  await context.close();
});
