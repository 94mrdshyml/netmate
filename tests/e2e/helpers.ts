import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "./constants";

/** The admin's invite link, read from the invite page with the stored admin login. */
export async function adminInviteLink(browser: Browser): Promise<string> {
  const context = await browser.newContext({ storageState: E2E.authFile });
  const page = await context.newPage();
  await page.goto("/invite");
  const link = await page.getByLabel("Your invite link").inputValue();
  await context.close();
  return link;
}

/** Opens an invite link and goes past the welcome screen to the sign-up form. */
export async function openSignUpForm(page: Page, link: string) {
  await page.goto(link);
  await page.getByRole("link", { name: /^Join / }).click();
  await expect(page.getByLabel("First name")).toBeVisible();
}

let counter = 0;

/**
 * A new member who joins through the admin's link, from an address of their own so the
 * per-address sign-up limit never trips (locally the header is ours to set). Returns a
 * signed-in page; the caller closes the context.
 */
export async function signUpMember(browser: Browser, ip: string, names: { first?: string; last?: string } = {}) {
  const link = await adminInviteLink(browser);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  const stamp = `${Date.now().toString(36)}${++counter}`;
  // This sign-up counts against its own link allowance, not the admin link's shared 20 per 10 minutes (the server
  // honours the cookie only when started with ENV "test"). rate-limit.spec.ts does not set it and tests the real limit.
  await context.addCookies([{ name: "e2e_scope", value: `su-${stamp}`, domain: new URL(link).hostname, path: "/" }]);
  const page = await context.newPage();
  await openSignUpForm(page, link);

  const username = `m_${stamp.slice(-11)}`;
  await page.getByLabel("First name").fill(names.first ?? "Other");
  await page.getByLabel("Last name").fill(names.last ?? "Member");
  const email = `member-${stamp}@example.com`;
  const password = "a-long-enough-pass";
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { page, context, username, email, password };
}

/**
 * Presses Post on the composer and waits for Home. Posting is limited to 10 a minute per person and
 * several specs post as the admin (posts.spec alone sends 10 in a burst), so how far apart they run
 * decides whether the limit has cleared. If the app says "Too many attempts", this waits out the
 * minute once and sends again, instead of failing on timing. The checks are the same.
 */
export async function sendPost(page: Page) {
  const send = page.getByRole("button", { name: "Post", exact: true });
  await send.click();

  const sent = page.waitForURL(/\/$/).then(() => "sent" as const, () => "waiting" as const);
  const refused = page
    .getByRole("alert")
    .filter({ hasText: "Too many attempts" })
    .waitFor()
    .then(() => "refused" as const, () => "waiting" as const);
  if ((await Promise.race([sent, refused])) === "refused") {
    test.setTimeout(120_000);
    await page.waitForTimeout(61_000);
    await send.click();
  }
  await expect(page).toHaveURL(/\/$/);
}
