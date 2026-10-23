import { expect, test } from "@playwright/test";
import { E2E } from "./constants";

test("home renders at phone width with the instance name and reaches D1 and R2", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: E2E.instance.name })).toBeVisible();
  await expect(page.getByText("D1 binding: ok")).toBeVisible();
  await expect(page.getByText("R2 binding: ok")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the browser tab is titled with the instance name", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(E2E.instance.name);
});
