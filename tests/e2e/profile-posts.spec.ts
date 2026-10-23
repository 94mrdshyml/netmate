import { expect, test } from "@playwright/test";
import { E2E } from "./constants";

// This spec writes nothing, so it can run at any point in the suite.
test("a profile shows how many posts the person has next to Following and Followers", async ({ page }) => {
  await page.goto(`/${E2E.admin.username}`);
  const counts = page.locator(".counts");
  await expect(counts).toBeVisible();

  // Posts first, then Following and Followers; Posts is plain text, the other two open lists.
  const posts = counts.getByText(/^\d+ Posts?$/);
  await expect(posts).toHaveCount(1);
  // The number is exact in the integration tests; here it only has to be there, whatever the other specs posted.
  expect(Number(/\d+/.exec((await posts.textContent()) ?? "")?.[0])).toBeGreaterThanOrEqual(0);
  await expect(counts.getByRole("link", { name: /Posts?$/ })).toHaveCount(0);
  await expect(counts.getByRole("link", { name: /Following$/ })).toBeVisible();
  await expect(counts.getByRole("link", { name: /Followers?$/ })).toBeVisible();
  expect(await counts.evaluate((el) => (el.firstElementChild?.textContent ?? "").includes("Post"))).toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
