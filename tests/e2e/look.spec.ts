import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";

const accountButton = (page: Page) => page.getByRole("button", { name: `Account, @${E2E.admin.username}` });
const menu = (page: Page) => page.getByRole("dialog", { name: "Account menu" });

test("my picture opens the account menu on Home, Search and Alerts", async ({ page }) => {
  for (const path of ["/", "/search", "/notifications"]) {
    await page.goto(path);
    await expect(accountButton(page)).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await accountButton(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "false");
  }
});

test("the menu lists Profile, Invite people, Settings, Admin panel and Log out, each easy to tap", async ({ page }) => {
  await page.goto("/");
  await accountButton(page).click();
  const sheet = menu(page);
  await expect(sheet).toContainText(`${E2E.admin.firstName} ${E2E.admin.lastName}`);
  await expect(sheet).toContainText(`@${E2E.admin.username}`);

  await expect(sheet.getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/${E2E.admin.username}`);
  await expect(sheet.getByRole("link", { name: "Invite people" })).toHaveAttribute("href", "/invite");
  await expect(sheet.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(sheet.getByRole("link", { name: "Admin panel" })).toHaveAttribute("href", "/hq");
  await expect(sheet.getByRole("button", { name: "Log out" })).toBeVisible();

  for (const control of [...(await sheet.getByRole("link").all()), sheet.getByRole("button", { name: "Log out" })]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // The sheet stays inside the phone screen.
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("Settings opens from the menu and closes it; tapping the dimmed page closes it too", async ({ page }) => {
  await page.goto("/");
  await accountButton(page).click();
  await menu(page).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // Settings is no longer a tab, so it has a way back.
  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(menu(page)).toBeHidden();

  await accountButton(page).click();
  await expect(menu(page)).toBeVisible();
  const width = page.viewportSize()!.width;
  await page.mouse.click(width - 8, 300); // the dimmed page to the right of the sheet
  await expect(menu(page)).toBeHidden();
});

test("Edit profile has a close button, Save in the header, counters on every field and camera buttons on the pictures", async ({ page }) => {
  await page.goto("/profile");
  const header = page.locator("header.edit-header");
  await expect(header.getByRole("heading", { name: "Edit profile" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(header.getByRole("link", { name: /^Close/ })).toHaveAttribute("href", `/${E2E.admin.username}`);

  // The pictures can be changed from the cover and from the picture itself.
  await expect(page.getByLabel("Cover picture")).toBeAttached();
  await expect(page.getByLabel("Profile picture")).toBeAttached();
  for (const label of ["Change cover picture", "Change profile picture"]) {
    const box = (await page.locator(`label[title="${label}"]`).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // Each field shows how many characters it has used.
  const bio = page.getByLabel("Bio");
  await bio.fill("Hello there");
  await expect(page.locator(".tfield").filter({ has: bio })).toContainText("11 / 160");
  await bio.fill("x".repeat(165));
  await expect(page.locator(".tfield").filter({ has: bio }).locator(".tfield-count")).toHaveClass(/over/);
  await expect(page.locator(".tfield").filter({ has: page.getByLabel("First name") })).toContainText(`/ 50`);

  // The username is shown but cannot be changed.
  await expect(page.getByLabel("Username")).toHaveAttribute("readonly", "");

  // The page fits the phone, and the header sticks while the page scrolls.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(header.getByRole("button", { name: "Save" })).toBeInViewport();

  // Close goes back to my profile without saving.
  await header.getByRole("link", { name: /^Close/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}$`));
});
