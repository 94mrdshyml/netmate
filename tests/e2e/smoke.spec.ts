import { expect, test } from "@playwright/test";

test("home renders at phone width and reaches D1 and R2", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Netmate" })).toBeVisible();
  await expect(page.getByText("D1 binding: ok")).toBeVisible();
  await expect(page.getByText("R2 binding: ok")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
