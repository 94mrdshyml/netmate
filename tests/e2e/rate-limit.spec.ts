import { expect, test } from "@playwright/test";

// Own addresses (the header is ours to set locally), so these tests never use up the
// limits other tests rely on. Not shared with invite.spec.ts.
test.use({ storageState: { cookies: [], origins: [] } });

test("the eleventh sign-in try for one email is refused with a plain wait time", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": "198.19.7.1" },
  });
  const page = await context.newPage();
  await page.goto("/sign-in");

  for (let i = 1; i <= 10; i++) {
    await page.getByLabel("Email").fill("nobody-here@example.com");
    await page.getByLabel("Password").fill(`wrong-password-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("p.banner")).toContainText("do not match");
  }

  await page.getByLabel("Password").fill("wrong-password-11");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("p.banner")).toContainText(/Too many attempts\. Try again in \d+ minutes?\./);
  await context.close();
});

test("the eleventh sign-up try from one address is refused", async ({ browser }) => {
  test.setTimeout(90_000);
  // The admin's own link, read from the invite page with the stored login.
  const admin = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json" });
  const adminPage = await admin.newPage();
  await adminPage.goto("/invite");
  const link = await adminPage.getByLabel("Your invite link").inputValue();
  await admin.close();

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": "198.19.7.2" },
  });
  const page = await context.newPage();
  await page.goto(link);

  // Empty submits are real attempts for the limiter, and cheap (no password hashing).
  for (let i = 1; i <= 10; i++) {
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("p.banner")).toContainText("Some answers need fixing");
    await page.reload();
  }

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("p.banner")).toContainText(/Too many attempts\. Try again in \d+ minutes?\./);
  await context.close();
});
