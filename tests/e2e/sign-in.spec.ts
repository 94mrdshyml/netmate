import { expect, test } from "./fixtures";
import { E2E } from "./constants";

// These tests start signed out: the project's stored admin session is not used here.
test.use({ storageState: { cookies: [], origins: [] } });

test("a signed-out visitor is sent to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(`Welcome back to ${E2E.instance.name}`)).toBeVisible();
});

test("a wrong password shows one plain message and stays on the page", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E.admin.email);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator("p.banner")).toContainText("do not match");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the sign-in page fits the phone column", async ({ page }) => {
  await page.goto("/sign-in");
  const width = await page.locator("main.column").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(480);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("signing in lands on Home, and signing out ends the session", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E.admin.email);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/${E2E.admin.username}`);

  // Already signed in: the sign-in page bounces back to Home.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The session is really gone, not just hidden.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
