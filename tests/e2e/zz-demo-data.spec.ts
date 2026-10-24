import { expect, test } from "@playwright/test";

// Named to run last: it fills the whole site with demo people, looks, and takes every one of them away again
// (also when a check fails), so no other spec ever sees them.

test("only the admin can open the demo page", async ({ browser }) => {
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await stranger.newPage();
  const res = await page.goto("/hq/demo");
  expect(res?.status()).toBe(404);
  await stranger.close();
});

test("the admin adds the demo people from /hq/demo, sees their posts, and removes them all again", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/hq/demo");
  await expect(page.getByRole("heading", { name: "Demo data", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add demo people" })).toBeEnabled();
  // Nothing to remove yet.
  await expect(page.getByRole("button", { name: "Remove demo data" })).toBeDisabled();

  try {
    await page.getByRole("button", { name: "Add demo people" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Working on step/ })).toBeVisible();
    await expect(page.getByText("Done. The demo people and posts are on the site.")).toBeVisible({ timeout: 200_000 });
    await expect(page.getByText(/14 people, \d+ posts/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Demo people are added" })).toBeDisabled();

    // Their posts are on the site, and a profile opens.
    await page.goto("/kwame_a");
    await expect(page.getByRole("heading", { name: "Kwame Asante" }).first()).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "Sunday league" })).toBeVisible();
    await page.goto("/search?q=sourdough");
    await expect(page.getByRole("article").filter({ hasText: "sourdough" }).first()).toBeVisible();
  } finally {
    await page.goto("/hq/demo");
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await page.getByRole("button", { name: "Yes, remove them" }).click();
    await expect(page.getByText(/^Removed 14 people, \d+ posts and \d+ pictures\.$/)).toBeVisible({ timeout: 60_000 });
  }

  // Gone for good: the profile, the search results, and the button is off again.
  const gone = await page.goto("/kwame_a");
  expect(gone?.status()).toBe(404);
  await page.goto("/hq/demo");
  await expect(page.getByRole("button", { name: "Add demo people" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Remove demo data" })).toBeDisabled();
  await page.goto("/search?q=sourdough");
  await expect(page.getByRole("article")).toHaveCount(0);
});
