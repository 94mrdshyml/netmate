import { expect, test } from "./fixtures";
import { E2E } from "./constants";

test("home renders at phone width with the instance name and reads the feed from D1", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: E2E.instance.name })).toBeVisible();
  await expect(page.getByLabel("Posts")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the browser tab is titled with the instance name", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(E2E.instance.name);
});
