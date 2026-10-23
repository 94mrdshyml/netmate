import { expect, test, type Browser, type Page } from "@playwright/test";
import { signUpMember } from "./helpers";

// Serial, and it leaves things as it found them: email not set up and the quota at its default of 5.
// The Worker runs with ENV=test, so mail goes to an in-memory fake, never to Resend. The fake's
// outbox is not readable from the browser, so these tests read what /hq/email records: when the
// last email went, and Resend's own error if it was refused. What each email says is checked in
// tests/integration/status-emails.test.ts and tests/email/messages.test.tsx.
test.describe.configure({ mode: "serial" });

const KEY = "re_test_e2esecretkey123456";
let nextVisitor = 0;

async function forget(page: Page) {
  await page.goto("/hq/email");
  const remove = page.getByRole("button", { name: "Remove email settings" });
  if (await remove.count()) {
    await remove.click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email is not set up." }).first()).toBeVisible();
  }
}

async function setUpEmail(page: Page, from: string) {
  await forget(page);
  await page.getByLabel("Sender address").fill(from);
  await page.getByLabel("Resend API key").fill(KEY);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

async function setQuota(page: Page, value: string) {
  await page.goto("/hq/invites");
  await page.getByLabel("Sign-ups approved per member link").fill(value);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#quota-note")).toContainText("Saved");
}

/** A member with an invite link of their own; with the quota at 0, everyone who uses it waits. */
async function memberLink(browser: Browser) {
  const m = await signUpMember(browser, `198.18.60.${++nextVisitor}`, { first: "Mona", last: "Status" });
  await m.page.goto("/invite");
  const link = await m.page.getByLabel("Your invite link").inputValue();
  await m.context.close();
  return link;
}

async function joinWaiting(browser: Browser, link: string, last: string) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": `198.18.60.${++nextVisitor}` },
  });
  const page = await context.newPage();
  await page.goto(link);
  const stamp = Date.now().toString(36);
  await page.getByLabel("First name").fill("Wilma");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(`status-${last.toLowerCase()}-${stamp}@example.com`);
  await page.getByLabel("Username").fill(`s_${last.toLowerCase()}_${stamp.slice(-4)}`.slice(0, 15));
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/waiting$/, { timeout: 20_000 });
  return context;
}

test("a sign-up that has to wait emails the admin, and the answer emails the person", async ({ page, browser }) => {
  try {
    await setUpEmail(page, "hello@example.org");
    await setQuota(page, "0");
    const link = await memberLink(browser);

    await page.goto("/hq/email");
    await expect(page.getByText("No email has been sent yet.")).toBeVisible();

    const guest = await joinWaiting(browser, link, "Waiter");
    await page.goto("/hq/email");
    await expect(page.getByText(/Last email sent .* UTC\./)).toBeVisible();
    await expect(page.getByText("No errors.")).toBeVisible();

    // Approving and rejecting still work, and neither reports an email problem.
    await page.goto("/hq/approvals");
    await page.getByRole("listitem").filter({ hasText: "Waiter" }).getByRole("button", { name: "Approve Wilma Waiter" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Waiter" })).toHaveCount(0);
    await guest.close();

    const second = await joinWaiting(browser, link, "Turnedaway");
    await page.goto("/hq/approvals");
    const row = page.getByRole("listitem").filter({ hasText: "Turnedaway" });
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    await row.getByRole("button", { name: "Yes, reject" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Turnedaway" })).toHaveCount(0);
    await second.close();

    await page.goto("/hq/email");
    await expect(page.getByText("No errors.")).toBeVisible();
  } finally {
    await setQuota(page, "5");
    await forget(page);
  }
});

test("when the email is refused, the sign-up and the approval still go through and /hq/email says why", async ({ page, browser }) => {
  try {
    // Saved fine, but the sender's domain is not verified, so every send is refused.
    await setUpEmail(page, "hello@nowhere.invalid");
    await setQuota(page, "0");
    const link = await memberLink(browser);

    const guest = await joinWaiting(browser, link, "Refused");

    await page.goto("/hq/approvals");
    await page.getByRole("listitem").filter({ hasText: "Refused" }).getByRole("button", { name: "Approve Wilma Refused" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Refused" })).toHaveCount(0);
    await guest.close();

    await page.goto("/hq/email");
    await expect(page.getByTestId("last-error")).toContainText("not verified");
  } finally {
    await setQuota(page, "5");
    await forget(page);
  }
});

test("with email not set up, a waiting sign-up works as before", async ({ page, browser }) => {
  try {
    await forget(page);
    await setQuota(page, "0");
    const link = await memberLink(browser);
    const guest = await joinWaiting(browser, link, "Quiet");
    await page.goto("/hq/approvals");
    await expect(page.getByRole("listitem").filter({ hasText: "Quiet" })).toBeVisible();
    await guest.close();
  } finally {
    await setQuota(page, "5");
  }
});
