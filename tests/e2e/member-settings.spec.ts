import { expect, test } from "./fixtures";

// Settings is a few short lists under plain headings, and explanation text under a header has room above it.

test("Settings is grouped under headings, in a fixed order", async ({ page }) => {
  await page.goto("/settings");
  const list = page.getByRole("list", { name: "Settings" });
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Account", "Yours", "Safety", "Running this space", "Look"]);

  const account = list.getByRole("list", { name: "Account" });
  await expect(account.getByRole("link")).toHaveText([/^Edit profile/, /^Privacy/]);
  const yours = list.getByRole("list", { name: "Yours" });
  await expect(yours.getByRole("link")).toHaveText([/^Saved posts/, /^Invite people/]);
  await expect(list.getByRole("list", { name: "Safety" }).getByRole("link", { name: /^Your reports/ })).toHaveAttribute("href", "/reports");
  await expect(list.getByRole("list", { name: "Running this space" }).getByRole("link", { name: /^Admin panel/ })).toHaveAttribute("href", "/hq");
  await expect(list.getByRole("list", { name: "Look" })).toContainText("Dark or light theme");

  // Subscriptions has no section while the owner has them off.
  await expect(list.getByRole("heading", { name: "Subscriptions" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a line of explanation under a header does not touch it", async ({ page }) => {
  for (const path of ["/bookmarks", "/reports"]) {
    await page.goto(path);
    const header = (await page.locator(".page-header").boundingBox())!;
    const hint = (await page.locator(".page-header + .hint").boundingBox())!;
    expect(hint.y - (header.y + header.height), path).toBeGreaterThanOrEqual(12);
  }
});
