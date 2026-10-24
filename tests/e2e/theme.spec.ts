import { expect, test } from "./fixtures";
import { E2E } from "./constants";

const cssVar = (name: string) => `getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`;

test("what the admin chose in setup reaches every page as CSS variables", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  expect(await page.evaluate(cssVar("--brand"))).toBe(E2E.instance.primary);
  expect(await page.evaluate(cssVar("--radius"))).toBe("16px");
  expect(await page.evaluate(cssVar("--font"))).toContain("Inter");

  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(light).toBe("rgb(255, 255, 255)");
});

test("follows the phone's dark setting with a true black page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(dark).toBe("rgb(0, 0, 0)");
  expect(await page.evaluate(cssVar("--bg"))).toBe("#000000");
});

test("a member's saved choice overrides the phone setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
});

test("content stays in one phone-width column", async ({ page }) => {
  await page.goto("/");
  const width = await page.locator("main.column").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(480);
});

const themeButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Switch between light and dark" });

test("the top bar shows the instance mark, my picture (a link to Settings) and the theme button", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator("header.topbar");
  await expect(bar).toContainText(E2E.instance.name);
  await expect(bar.getByRole("link", { name: `Settings, signed in as @${E2E.admin.username}` })).toHaveAttribute("href", "/settings");
  await expect(themeButton(page)).toBeVisible();

  // Both are easy to hit and the page never scrolls sideways.
  for (const control of [bar.getByRole("link"), bar.getByRole("button")]) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the theme button switches light and dark, and the server remembers the choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

  await themeButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");

  // After a reload the server paints the same theme from the cookie, so there is no flash.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await themeButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Settings has a Dark or light theme row that switches the theme and remembers it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

  const toggle = page.getByRole("list", { name: "Settings" }).getByRole("button", { name: "Switch between light and dark" });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
