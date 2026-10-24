import { E2E } from "./constants";
import { expect, test } from "./fixtures";

// The admin panel's shape: five groups in the menu, Money as one section with tabs, the quick search, and the old addresses.

test("the menu has five groups, and Money is one item", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/hq");
  const menu = page.getByRole("navigation", { name: "Admin" });
  await expect(menu.locator(".hq-nav-label")).toHaveText(["Home", "People", "Insights", "Money", "Settings"]);
  for (const name of ["Overview", "Members", "Approvals", "Invites", "Reports", "Activity", "Money", "Branding", "Email", "Services", "Demo data"]) {
    await expect(menu.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveCount(1);
  }
  // Payments and Revenue are no longer menu items: they are tabs inside Money.
  await expect(menu.getByRole("link", { name: /^(Payments|Revenue)/ })).toHaveCount(0);
});

test("Money has three tabs, the current one is marked, and the breadcrumbs follow", async ({ page }) => {
  await page.goto("/hq/money");
  const tabs = page.getByRole("navigation", { name: "Money" });
  await expect(tabs.getByRole("link")).toHaveText(["Overview", "Members and payouts", "Polar setup"]);
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("link", { name: "Polar setup" }).click();
  await expect(page).toHaveURL(/\/hq\/money\/setup$/);
  await expect(tabs.getByRole("link", { name: "Polar setup" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Money" })).toHaveAttribute("aria-current", "page");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("Admin");
  await expect(crumbs).toContainText("Money");
  await expect(crumbs.getByRole("listitem").last()).toHaveText("Polar setup");

  await tabs.getByRole("link", { name: "Members and payouts" }).click();
  await expect(page).toHaveURL(/\/hq\/money\/payouts$/);
  await expect(page.getByRole("list", { name: "Recorded payouts" }).or(page.getByText("No payouts recorded yet."))).toBeVisible();
});

test("the old Payments and Revenue addresses lead to their new place", async ({ page }) => {
  await page.goto("/hq/payments");
  await expect(page).toHaveURL(/\/hq\/money\/setup$/);
  await page.goto("/hq/revenue");
  await expect(page).toHaveURL(/\/hq\/money$/);
});

test("the quick search jumps to a page from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/hq");
  await expect(page.locator(".hq-search-button[data-ready]")).toBeVisible();
  await page.keyboard.press("/");
  const box = page.getByRole("dialog", { name: "Go to a page or person" });
  await expect(box).toBeVisible();
  await box.getByRole("searchbox", { name: "Go to a page or person" }).fill("polar");
  await expect(box.getByRole("link", { name: /Polar setup/ })).toBeVisible();
  await expect(box.getByRole("link", { name: /Branding/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/hq\/money\/setup$/);
  await expect(box).toBeHidden();

  // Escape closes it, and it can look a person up from anywhere.
  await page.keyboard.press("Control+k");
  await expect(box).toBeVisible();
  await box.getByRole("searchbox").fill("riya");
  await box.getByRole("link", { name: /Find members matching "riya"/ }).click();
  await expect(page).toHaveURL(/\/hq\/members\?q=riya$/);
  await page.keyboard.press("/");
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

test("on a phone the search is a button you can tap, and a word no page has can still look a person up", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq");
  const button = page.getByRole("button", { name: "Go to a page or person" });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await button.click();
  const box = page.getByRole("dialog", { name: "Go to a page or person" });
  await box.getByRole("searchbox").fill("zzzz");
  await expect(box.getByRole("link")).toHaveCount(1);
  await expect(box.getByRole("link", { name: /Find members matching "zzzz"/ })).toBeVisible();
  await box.getByRole("button", { name: "Close" }).click();
  await expect(box).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("a member's row shows the main numbers and folds the rest under All numbers", async ({ page }) => {
  await page.goto("/hq/members");
  const row = page.getByRole("listitem").filter({ hasText: `@${E2E.admin.username}` }).first();
  await expect(row.locator(".hq-headline")).toContainText("Posts");
  await expect(row.locator(".hq-headline")).not.toContainText("Link cards");
  await row.getByText("All numbers").click();
  await expect(row.getByText("Link cards")).toBeVisible();
});
