import { expect, test, type Page } from "@playwright/test";

// Serial: each test starts from "email is not set up" and leaves it that way. The Worker runs
// with ENV=test, so the Resend key is checked and the mail sent by an in-memory fake, never Resend:
// a key starting re_test_ is accepted, and a sender on a .invalid domain is refused like an
// unverified domain. Test emails are limited to five an hour, so this file sends only three.
test.describe.configure({ mode: "serial" });

const KEY = "re_test_e2esecretkey123456";

async function forget(page: Page) {
  await page.goto("/hq/email");
  const remove = page.getByRole("button", { name: "Remove email settings" });
  if (await remove.count()) {
    await remove.click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email is not set up." }).first()).toBeVisible();
  }
}

async function save(page: Page, from: string, key: string) {
  await page.getByLabel("Sender address").fill(from);
  await page.getByLabel("Resend API key").fill(key);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("before setup there is a banner everywhere in /hq and no test button", async ({ page }) => {
  await forget(page);
  await expect(page.getByRole("status").filter({ hasText: "Email is not set up, so people" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Set up email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test email" })).toHaveCount(0);

  await page.goto("/hq/branding");
  await expect(page.getByRole("status").filter({ hasText: "Email is not set up, so people" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Email" })).toBeVisible();
});

test("bad answers are explained and nothing is saved", async ({ page }) => {
  await forget(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Some answers need fixing." })).toBeVisible();
  await expect(page.locator("#from-note")).toContainText("Enter the address");
  await expect(page.locator("#apiKey-note")).toContainText("Enter your Resend key");

  await save(page, "not-an-address", "sk_123456789");
  await expect(page.locator("#from-note")).toContainText("valid email address");
  await expect(page.locator("#apiKey-note")).toContainText("starts with re_");

  // A well-formed key that Resend does not accept.
  await save(page, "hello@example.org", "re_live_notaccepted123");
  await expect(page.locator("#apiKey-note")).toContainText("did not accept");

  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Email is not set up." }).first()).toBeVisible();
});

test("saving sets email up, hides the banner, and never shows the key again", async ({ page }) => {
  try {
    await forget(page);
    await save(page, "hello@example.org", KEY);
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Email is set up." })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Email is not set up, so people" })).toHaveCount(0);
    await expect(page.getByLabel("Sender address")).toHaveValue("hello@example.org");

    // The key is saved but is not in the page, the box, or anything the server sent.
    const box = page.getByLabel("Resend API key");
    await expect(box).toHaveValue("");
    await expect(box).toHaveAttribute("placeholder", "Key saved");
    expect(await page.content()).not.toContain(KEY);

    // Leaving the key empty keeps it, so changing only the sender works.
    await page.getByLabel("Sender address").fill("news@example.org");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Sender address")).toHaveValue("news@example.org");
  } finally {
    await forget(page);
  }
});

test("the test email reaches the admin's own inbox through the fake outbox", async ({ page }) => {
  try {
    await forget(page);
    await save(page, "hello@example.org", KEY);
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await expect(page.getByText("No email has been sent yet.")).toBeVisible();
    await page.getByRole("button", { name: "Send test email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test email sent." })).toBeVisible();
    await expect(page.getByText(/Last email sent .* UTC\./)).toBeVisible();
    await expect(page.getByText("No errors.")).toBeVisible();
  } finally {
    await forget(page);
  }
});

test("Resend's own error is shown, kept for the next visit, and cleared by a good send", async ({ page }) => {
  try {
    await forget(page);
    // Saved fine (the key is good), but the sender's domain is not verified.
    await save(page, "hello@nowhere.invalid", KEY);
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.getByRole("button", { name: "Send test email" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "not verified" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("last-error")).toContainText("not verified");
    expect(await page.getByTestId("last-error").textContent()).not.toContain("@");

    await page.getByLabel("Sender address").fill("hello@example.org");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.getByRole("button", { name: "Send test email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test email sent." })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("last-error")).toHaveCount(0);
    await expect(page.getByText("No errors.")).toBeVisible();
  } finally {
    await forget(page);
  }
});

test("removing asks first, then email is not set up again", async ({ page }) => {
  await forget(page);
  await save(page, "hello@example.org", KEY);
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.getByRole("button", { name: "Remove email settings" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Send test email" })).toBeVisible();

  await page.getByRole("button", { name: "Remove email settings" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Email is not set up." }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sender address")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Send test email" })).toHaveCount(0);
});

test("a signed-out visitor gets a plain not found on the email page", async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  expect((await page.goto("/hq/email"))?.status()).toBe(404);
  await anonymous.close();
});

test("the page fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/email");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
