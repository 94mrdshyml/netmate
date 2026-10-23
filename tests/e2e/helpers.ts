import { expect, type Browser } from "@playwright/test";
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
  const page = await context.newPage();
  await page.goto(link);

  const stamp = `${Date.now().toString(36)}${++counter}`;
  const username = `m_${stamp.slice(-11)}`;
  await page.getByLabel("First name").fill(names.first ?? "Other");
  await page.getByLabel("Last name").fill(names.last ?? "Member");
  await page.getByLabel("Email").fill(`member-${stamp}@example.com`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { page, context, username };
}
