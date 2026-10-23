import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";

// One fresh, unconfigured instance. The tests run in order: they walk the real /setup
// flow, then leave the admin signed in for every other test file (see playwright.config.ts).
test.describe.configure({ mode: "serial" });

async function next(page: Page) {
  await page.getByRole("button", { name: "Next" }).click();
}

test("an unconfigured instance sends every page to /setup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Prove it is you" })).toBeVisible();
  await expect(page.getByText("Step 1 of 6")).toBeVisible();
});

test("a wrong setup token is refused at the end and nothing is created", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Setup token").fill("definitely-not-the-token");
  await next(page);

  await page.getByLabel("First name").fill("Eve");
  await page.getByLabel("Last name").fill("Intruder");
  await page.getByLabel("Email", { exact: true }).fill("eve@example.com");
  await page.getByLabel("Username").fill("eve_in");
  await page.getByLabel("Password").fill("a-long-password-1");
  await next(page);
  await next(page); // name
  await next(page); // look
  await next(page); // email
  await page.getByRole("button", { name: "Finish setup" }).click();

  // Sent back to the token step with a clear message.
  await expect(page.locator("p.banner")).toContainText("setup token is not correct");
  await expect(page.getByRole("heading", { name: "Prove it is you" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
});

test("each step explains what is wrong before moving on", async ({ page }) => {
  await page.goto("/setup");
  await next(page);
  await expect(page.getByText("Step 1 of 6")).toBeVisible();
  await expect(page.locator("p.error")).toContainText("Enter the setup token");

  await page.getByLabel("Setup token").fill(E2E.setupToken);
  await next(page);
  await next(page);
  await expect(page.getByText("Step 2 of 6")).toBeVisible();
  await expect(page.getByText("Enter your first name")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 8 characters")).toBeVisible();

  await page.getByLabel("First name").fill("Riya");
  await page.getByLabel("Last name").fill("Sen");
  await page.getByLabel("Email", { exact: true }).fill("riya@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByLabel("Username").fill("admin");
  await next(page);
  await expect(page.getByText("That username is reserved")).toBeVisible();
});

test("the look step previews light and dark, and says when it adjusts a colour", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Setup token").fill(E2E.setupToken);
  await next(page);
  await page.getByLabel("First name").fill("Riya");
  await page.getByLabel("Last name").fill("Sen");
  await page.getByLabel("Email", { exact: true }).fill("riya@example.com");
  await page.getByLabel("Username").fill("riya_sen");
  await page.getByLabel("Password").fill("correct horse battery");
  await next(page);
  await next(page); // name
  await expect(page.getByRole("heading", { name: "Choose the look" })).toBeVisible();

  await expect(page.getByTestId("preview-light")).toBeVisible();
  await expect(page.getByTestId("preview-dark")).toBeVisible();

  // A very light yellow cannot be read on white, so it is adjusted and the person is told.
  await page.getByLabel("Primary colour").fill("#FFD400");
  await expect(page.getByRole("status")).toContainText("adjusted");

  // Each panel carries its own variables.
  const lightBg = await page.getByTestId("preview-light").evaluate((el) => getComputedStyle(el).backgroundColor);
  const darkBg = await page.getByTestId("preview-dark").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lightBg).toBe("rgb(255, 255, 255)");
  expect(darkBg).toBe("rgb(0, 0, 0)");

  await page.getByLabel("Round").check();
  const radius = await page.getByTestId("preview-light").evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe("16px");
});

test("the full flow creates the instance, signs the admin in and locks /setup for ever", async ({ page }) => {
  await page.goto("/setup");

  await page.getByLabel("Setup token").fill(E2E.setupToken);
  await next(page);

  await page.getByLabel("First name").fill(E2E.admin.firstName);
  await page.getByLabel("Last name").fill(E2E.admin.lastName);
  await page.getByLabel("Email", { exact: true }).fill(E2E.admin.email);
  await page.getByLabel("Username").fill(E2E.admin.username);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await next(page);

  await page.getByLabel("Instance name").fill(E2E.instance.name);
  await next(page);

  await page.getByLabel("Primary colour").fill(E2E.instance.primary);
  await page.getByLabel("Round").check();
  await next(page);

  // Email is optional: skip it, and the page says what that means.
  await expect(page.getByText("Without email")).toBeVisible();
  await next(page);

  await page.getByRole("button", { name: "Finish setup" }).click();

  // Lands on the home page of the new instance, already signed in, with the chosen name.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: E2E.instance.name })).toBeVisible();
  await expect(page.getByText(`Signed in as @${E2E.admin.username}`)).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name.includes("session_token"))).toBe(true);
  await page.context().storageState({ path: E2E.authFile });

  // Setup is gone for ever, even for the person who just did it.
  const again = await page.goto("/setup");
  expect(again?.status()).toBe(404);
});

test("a stranger cannot run setup again", async ({ browser }) => {
  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  const res = await page.goto("/setup");
  expect(res?.status()).toBe(404);
  await stranger.close();
});
