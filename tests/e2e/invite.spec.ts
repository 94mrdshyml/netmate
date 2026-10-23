import { expect, test, type Browser, type Page } from "@playwright/test";

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

/** A visitor with no session (the project's stored admin login is not inherited), who opens an invite link. */
async function visitor(browser: Browser, link: string) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": `198.18.1.${++nextVisitor}` },
  });
  const page = await context.newPage();
  await page.goto(link);
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
    const { page, context } = await visitor(browser, path);
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
