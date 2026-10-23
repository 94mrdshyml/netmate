import { expect, test } from "@playwright/test";
import { E2E } from "./constants";

// Serial, and every test puts the original look back: other specs read the name, so a change is
// held for as short a time as possible.
test.describe.configure({ mode: "serial" });

const restore = async (page: import("@playwright/test").Page) => {
  await page.goto("/hq/branding");
  await page.getByLabel("Name", { exact: true }).fill(E2E.instance.name);
  await page.locator("#primary").fill(E2E.instance.primary);
  await page.getByRole("radio", { name: "Round" }).check();
  await page.getByLabel("Font").selectOption("Inter");
  await page.getByRole("radio", { name: "initials" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
};

test("the form starts with the saved look and the preview follows what is typed", async ({ page }) => {
  await page.goto("/hq/branding");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);
  await expect(page.locator("#primary")).toHaveValue(E2E.instance.primary);
  await expect(page.getByTestId("preview-light")).toContainText(E2E.instance.name);

  await page.getByLabel("Name", { exact: true }).fill("Preview Only");
  await expect(page.getByTestId("preview-light")).toContainText("Preview Only");
  await expect(page.getByTestId("preview-dark")).toContainText("Preview Only");

  // Typing is not saving: a fresh load still shows the saved name.
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);

  await page.locator("#primary").fill("#FFFF00");
  await expect(page.locator("#primary-note")).toContainText("We adjust this colour slightly in light");
  const lightButton = await page.getByTestId("preview-light").getByRole("button").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lightButton).not.toBe("rgb(255, 255, 0)");
});

test("bad answers are explained and nothing is saved", async ({ page }) => {
  await page.goto("/hq/branding");
  await page.getByLabel("Name", { exact: true }).fill("   ");
  await page.locator("#primary").fill("red");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Some answers need fixing." })).toBeVisible();
  await expect(page.locator("#name-note")).toContainText("Enter a name");
  await expect(page.locator("#primary-note")).toContainText("Pick a colour");

  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);
});

test("saving changes the name, colour and corners for everyone at once, and putting it back works", async ({ page, browser }) => {
  try {
    await page.goto("/hq/branding");
    await page.getByLabel("Name", { exact: true }).fill("Riverbank");
    await page.locator("#primary").fill("#C2410C");
    await page.getByRole("radio", { name: "Square" }).check();
    await page.getByRole("radio", { name: "pixel art neutral" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    // The admin header uses the new name straight away.
    await expect(page.getByText("Riverbank admin")).toBeVisible();

    // A signed-out visitor sees the new name and the new theme variables, with no redeploy.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await visitor.newPage();
    await guest.goto("/sign-in");
    await expect(guest.getByText("Welcome back to Riverbank")).toBeVisible();
    const css = await guest.locator("#instance-theme").evaluate((el) => el.textContent ?? "");
    expect(css).toContain("--radius:0px");
    expect(css).toMatch(/--brand-text:#[0-9a-f]{6}/i);
    await visitor.close();

    // And it survives a reload of the form.
    await page.goto("/hq/branding");
    await expect(page.locator("#primary")).toHaveValue("#C2410C");
    await expect(page.getByRole("radio", { name: "Square" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "pixel art neutral" })).toBeChecked();
  } finally {
    await restore(page);
  }

  // Back to what setup chose (theme.spec reads it): name, colour and the Round corners.
  await page.goto("/hq/branding");
  await expect(page.getByRole("radio", { name: "Round" })).toBeChecked();
  await expect(page.getByText(`${E2E.instance.name} admin`)).toBeVisible();
});

test("the default avatar styles are drawn on our own server, with no request to another site", async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== new URL(baseURL!).origin) outside.push(u);
  });
  await page.goto("/hq/branding");
  const samples = page.locator(".avatar-choice img");
  await expect(samples).toHaveCount(8);
  for (const img of await samples.all()) {
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  expect(outside).toEqual([]);
});

test("a signed-out visitor gets a plain not found on the branding page", async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  expect((await page.goto("/hq/branding"))?.status()).toBe(404);
  await anonymous.close();
});

test("the form fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/branding");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
