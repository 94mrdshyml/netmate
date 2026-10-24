import { expect, test } from "./fixtures";

// The admin's Payments page. Nothing here calls Polar: the keys are only saved and shown as saved. Serial: one
// step uses what the one before saved, and the last one puts the page back as it was.
test.describe.configure({ mode: "serial" });

// Made-up keys, built from repeated words so that no key-shaped text sits in the file (the secret scan would flag it).
const TOKEN = `polar_oat_${"faketoken".repeat(3)}`;
const SECRET = `whsec_${"fakesecret".repeat(3)}`;

test("the admin sets how payments are shared, and sees what it means in dollars", async ({ page }) => {
  await page.goto("/hq");
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Money" }).click();
  await page.getByRole("navigation", { name: "Money" }).getByRole("link", { name: "Polar setup" }).click();
  await expect(page).toHaveURL(/\/hq\/money\/setup$/);
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();

  const box = page.getByLabel("Percent the member earns");
  await box.fill("55");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByText("Saved.")).toBeVisible();
  // The owner's own example: $10 at 55% is $5.50.
  await expect(page.getByText(/They earn \$5\.50 and your side is \$4\.50/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Percent the member earns")).toHaveValue("55");

  await page.getByLabel("Percent the member earns").fill("150");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "whole number from 0 to 100" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Percent the member earns")).toHaveValue("55");
});

test("the Polar keys are saved locked, never shown again, and can be removed", async ({ page }) => {
  await page.goto("/hq/money/setup");
  await expect(page.getByText("Not connected")).toBeVisible();
  // The webhook address is ours, ready to copy.
  await expect(page.getByLabel("Webhook address to give Polar")).toHaveValue(/\/api\/webhooks\/polar$/);

  await page.getByLabel("Polar access token").fill(TOKEN);
  await page.getByLabel("Polar webhook secret").fill(SECRET);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Keys saved", { exact: true })).toBeVisible();

  // Gone from the boxes and from the page; only the "saved" hints remain.
  await expect(page.getByLabel("Polar access token")).toHaveValue("");
  await expect(page.getByLabel("Polar access token")).toHaveAttribute("placeholder", "Token saved");
  await expect(page.getByLabel("Polar webhook secret")).toHaveAttribute("placeholder", "Secret saved");
  const html = await page.content();
  expect(html).not.toContain(TOKEN);
  expect(html).not.toContain(SECRET);
  await page.reload();
  expect(await page.content()).not.toContain(TOKEN);

  // A bad paste is refused with a plain sentence and keeps what is saved.
  await page.getByLabel("Polar access token").fill("nope");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "does not look like a Polar access token" })).toBeVisible();
  await expect(page.getByText("Keys saved", { exact: true })).toBeVisible();

  // Removing asks first.
  await page.getByLabel("Polar access token").fill("");
  await page.getByRole("button", { name: "Remove the keys" }).click();
  await page.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
});

test("the page fits a phone, and the split goes back to its default", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/money/setup");
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const control of [page.getByLabel("Percent the member earns"), page.getByRole("button", { name: "Save", exact: true }).first()]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByLabel("Percent the member earns").fill("50");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByText("Saved.")).toBeVisible();
});
