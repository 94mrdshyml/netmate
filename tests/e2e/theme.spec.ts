import { expect, test } from "@playwright/test";
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
