import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSignUpForm, signUpMember } from "./helpers";

// Serial: each step uses what the one before made. The invite quota is an instance setting other
// files depend on, so it is never changed to anything but its default here. The member's five
// automatic approvals are used up instead, so the next sign-ups through their link wait.
test.describe.configure({ mode: "serial" });

let nextVisitor = 0;
let memberPage: Page;
let closeMember: () => Promise<void>;
let memberName = "";
let memberLink = "";
let fillerEmail = "";

/** A visitor with no session, from an address of their own, who opens a link and signs up. */
async function joinThrough(browser: Browser, link: string, last: string) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": `198.18.41.${++nextVisitor}` },
  });
  const page = await context.newPage();
  await openSignUpForm(page, link);
  const stamp = Date.now().toString(36);
  const email = `hq-${last.toLowerCase()}-${stamp}@example.com`;
  await page.getByLabel("First name").fill("Wanda");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(`w_${last.toLowerCase()}_${stamp.slice(-4)}`.slice(0, 15));
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  return { page, context, email };
}

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.40.1", { first: "Hosta", last: "Hq" });
  memberPage = m.page;
  closeMember = () => m.context.close();
  memberName = "Hosta Hq";
  await memberPage.goto("/invite");
  memberLink = await memberPage.getByLabel("Your invite link").inputValue();
  for (const n of [1, 2, 3, 4, 5]) {
    const filler = await joinThrough(browser, memberLink, `Filler${n}`);
    // Password hashing is slow when several test files run at once, so allow more than the default 5 seconds.
    await expect(filler.page).toHaveURL(/\/$/, { timeout: 20_000 });
    if (n === 1) fillerEmail = filler.email;
    await filler.context.close();
  }
});

test.afterAll(async () => {
  await closeMember();
});

test("the admin sets how many sign-ups a member link approves", async ({ page }) => {
  await page.goto("/hq/invites");
  await page.getByLabel("Sign-ups approved per member link").fill("lots");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#quota-note")).toContainText("whole number from 0 to 1000");

  await page.getByLabel("Sign-ups approved per member link").fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#quota-note")).toContainText("Saved");

  await page.reload();
  await expect(page.getByLabel("Sign-ups approved per member link")).toHaveValue("5");
  await expect(page.getByRole("listitem").filter({ hasText: memberName })).toContainText("5 of 5 automatic approvals used");
});

test("a sign-up past the quota waits, shows in Approvals, and can be approved", async ({ page, browser }) => {
  const guest = await joinThrough(browser, memberLink, "Approvee");
  await expect(guest.page).toHaveURL(/\/waiting$/);

  await page.goto("/hq");
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /Approvals/ })).toContainText(/\d/);

  await page.goto("/hq/approvals");
  const row = page.getByRole("listitem").filter({ hasText: "Approvee" });
  await expect(row).toContainText(guest.email);
  await expect(row).toContainText(`through ${memberName}'s link`);

  // Still locked out until approved.
  await guest.page.goto("/sign-in");
  await guest.page.getByLabel("Email").fill(guest.email);
  await guest.page.getByLabel("Password").fill("a-long-enough-pass");
  await guest.page.getByRole("button", { name: "Sign in" }).click();
  await expect(guest.page.getByText("Your account is waiting for approval")).toBeVisible();

  await row.getByRole("button", { name: "Approve Wanda Approvee" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Approvee" })).toHaveCount(0);

  await guest.page.goto("/sign-in");
  await guest.page.getByLabel("Email").fill(guest.email);
  await guest.page.getByLabel("Password").fill("a-long-enough-pass");
  await guest.page.getByRole("button", { name: "Sign in" }).click();
  await expect(guest.page).toHaveURL(/\/$/);
  await guest.context.close();
});

test("rejecting asks first, then deletes the account", async ({ page, browser }) => {
  const guest = await joinThrough(browser, memberLink, "Rejectee");
  await expect(guest.page).toHaveURL(/\/waiting$/);

  await page.goto("/hq/approvals");
  const row = page.getByRole("listitem").filter({ hasText: "Rejectee" });
  await row.getByRole("button", { name: "Reject", exact: true }).click();
  // Nothing happens until it is confirmed, and cancelling leaves the person in the queue.
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reject", exact: true }).click();
  await row.getByRole("button", { name: "Yes, reject" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Rejectee" })).toHaveCount(0);

  // The account is gone: the same details cannot sign in.
  await guest.page.goto("/sign-in");
  await guest.page.getByLabel("Email").fill(guest.email);
  await guest.page.getByLabel("Password").fill("a-long-enough-pass");
  await guest.page.getByRole("button", { name: "Sign in" }).click();
  await expect(guest.page.getByRole("alert")).toBeVisible();
  await expect(guest.page).not.toHaveURL(/\/waiting$/);
  await guest.context.close();
});

// Sign-up status emails. These live here because this file's member already used up the automatic
// approvals, so people joining through the link wait, and no extra sign-up goes through the admin's
// link, which allows only 20 sign-ups per ten minutes across the whole run). The Worker runs with
// ENV=test, so mail goes to an in-memory fake, never to Resend. The fake's outbox is not readable
// from the browser, so these read what /hq/email records: when the last email went, and Resend's
// own error if it was refused. What each email says is checked in tests/integration/status-emails.test.ts
// and tests/email/messages.test.tsx. Each test leaves email not set up.
const RESEND_KEY = "re_test_e2esecretkey123456";

async function forgetEmail(page: Page) {
  await page.goto("/hq/email");
  const remove = page.getByRole("button", { name: "Remove email settings" });
  if (await remove.count()) {
    await remove.click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email is not set up." }).first()).toBeVisible();
  }
}

async function setUpEmail(page: Page, from: string) {
  await forgetEmail(page);
  await page.getByLabel("Sender address").fill(from);
  await page.getByLabel("Resend API key").fill(RESEND_KEY);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

test("a waiting sign-up emails the admin, and approving or rejecting still works with email set up", async ({ page, browser }) => {
  try {
    await setUpEmail(page, "hello@example.org");
    await expect(page.getByText("No email has been sent yet.")).toBeVisible();

    const waiter = await joinThrough(browser, memberLink, "Mailwaiter");
    await expect(waiter.page).toHaveURL(/\/waiting$/, { timeout: 20_000 });
    await page.goto("/hq/email");
    await expect(page.getByText(/Last email sent .* UTC\./)).toBeVisible();
    await expect(page.getByText("No errors.")).toBeVisible();

    await page.goto("/hq/approvals");
    await page.getByRole("listitem").filter({ hasText: "Mailwaiter" }).getByRole("button", { name: "Approve Wanda Mailwaiter" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Mailwaiter" })).toHaveCount(0);
    await waiter.context.close();

    const turned = await joinThrough(browser, memberLink, "Mailturned");
    await expect(turned.page).toHaveURL(/\/waiting$/, { timeout: 20_000 });
    await page.goto("/hq/approvals");
    const row = page.getByRole("listitem").filter({ hasText: "Mailturned" });
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    await row.getByRole("button", { name: "Yes, reject" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Mailturned" })).toHaveCount(0);
    await turned.context.close();

    await page.goto("/hq/email");
    await expect(page.getByText("No errors.")).toBeVisible();
  } finally {
    await forgetEmail(page);
  }
});

test("when the email is refused, sign-up and approval still go through and /hq/email says why", async ({ page, browser }) => {
  try {
    // Saved fine, but the sender's domain is not verified, so every send is refused.
    await setUpEmail(page, "hello@nowhere.invalid");
    const refused = await joinThrough(browser, memberLink, "Mailrefused");
    await expect(refused.page).toHaveURL(/\/waiting$/, { timeout: 20_000 });

    await page.goto("/hq/approvals");
    await page.getByRole("listitem").filter({ hasText: "Mailrefused" }).getByRole("button", { name: "Approve Wanda Mailrefused" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Mailrefused" })).toHaveCount(0);
    await refused.context.close();

    await page.goto("/hq/email");
    await expect(page.getByTestId("last-error")).toContainText("not verified");
  } finally {
    await forgetEmail(page);
  }
});

test("with email not set up, a waiting sign-up works as before", async ({ page, browser }) => {
  await forgetEmail(page);
  const quiet = await joinThrough(browser, memberLink, "Mailquiet");
  await expect(quiet.page).toHaveURL(/\/waiting$/, { timeout: 20_000 });
  await page.goto("/hq/approvals");
  const row = page.getByRole("listitem").filter({ hasText: "Mailquiet" });
  await expect(row).toBeVisible();
  // Leave the queue empty for the next test.
  await row.getByRole("button", { name: "Reject", exact: true }).click();
  await row.getByRole("button", { name: "Yes, reject" }).click();
  await expect(row).toHaveCount(0);
  await quiet.context.close();
});

// Forgot password. The member is one of this file's fillers (already in, with a known address and
// password), so no extra sign-up goes through the admin's link. The reset link is read from the fake
// mail through the test-only outbox route, which answers only when the Worker runs with ENV=test.
const FILLER_PASSWORD = "a-long-enough-pass";
const NEW_PASSWORD = "a-brand-new-password-2";

async function resetLinkFor(page: Page, to: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/test-outbox?to=${encodeURIComponent(to)}`);
        const body = (await res.json()) as { items: { text: string }[] };
        const last = body.items.at(-1)?.text ?? "";
        link = /https?:\/\/[^\s"<>]+\/reset-password\?token=[^\s"<>]+/.exec(last)?.[0] ?? "";
        return link;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  return link;
}

async function trySignIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("without email, sign-in has no forgot link and the reset page says it is not available", async ({ browser, page }) => {
  await forgetEmail(page);
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto("/sign-in");
  await expect(visitor.getByRole("link", { name: "Forgot your password?" })).toHaveCount(0);
  await visitor.goto("/forgot-password");
  await expect(visitor.getByText("Password reset is not available because")).toBeVisible();
  await expect(visitor.getByLabel("Email")).toHaveCount(0);
  await anonymous.close();
});

test("a member who forgot their password gets a link, chooses a new password, and signs in with it", async ({ page, browser }) => {
  try {
    await setUpEmail(page, "hello@example.org");
    const anonymous = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "cf-connecting-ip": "198.18.77.1" },
    });
    const visitor = await anonymous.newPage();

    await visitor.goto("/sign-in");
    await visitor.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(visitor).toHaveURL(/\/forgot-password$/);
    await visitor.getByLabel("Email").fill("not an address");
    await visitor.getByRole("button", { name: "Send reset link" }).click();
    await expect(visitor.getByRole("alert").filter({ hasText: "Enter a valid email address" })).toBeVisible();

    await visitor.getByLabel("Email").fill(fillerEmail);
    await visitor.getByRole("button", { name: "Send reset link" }).click();
    await expect(visitor.getByRole("status").filter({ hasText: "If that address belongs to a member" })).toBeVisible();

    const link = await resetLinkFor(visitor, fillerEmail);
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);

    await visitor.getByLabel("New password").fill("short");
    await visitor.getByRole("button", { name: "Save new password" }).click();
    await expect(visitor.getByRole("alert").filter({ hasText: "Use at least 8 characters" })).toBeVisible();

    await visitor.getByLabel("New password").fill(NEW_PASSWORD);
    await visitor.getByRole("button", { name: "Save new password" }).click();
    await expect(visitor).toHaveURL(/\/sign-in\?reset=1$/);
    await expect(visitor.getByRole("status").filter({ hasText: "Your password was changed" })).toBeVisible();

    // The old password is dead and the new one works.
    await trySignIn(visitor, fillerEmail, FILLER_PASSWORD);
    await expect(visitor.getByRole("alert")).toBeVisible();
    await trySignIn(visitor, fillerEmail, NEW_PASSWORD);
    await expect(visitor).toHaveURL(/\/$/);

    // The same link cannot be used again.
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name: "Link not valid" })).toBeVisible();
    await expect(visitor.getByLabel("New password")).toHaveCount(0);
    await anonymous.close();
  } finally {
    await forgetEmail(page);
  }
});

test("asking for a link for an address that is not a member looks the same and sends nothing", async ({ page, browser }) => {
  try {
    await setUpEmail(page, "hello@example.org");
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "cf-connecting-ip": "198.18.77.2" },
    });
    const visitor = await anonymous.newPage();
    const stranger = `nobody-${Date.now().toString(36)}@example.org`;
    await visitor.goto("/forgot-password");
    await visitor.getByLabel("Email").fill(stranger);
    await visitor.getByRole("button", { name: "Send reset link" }).click();
    await expect(visitor.getByRole("status").filter({ hasText: "If that address belongs to a member" })).toBeVisible();

    // Give a background send time to happen, then check that nothing went to that address.
    await visitor.waitForTimeout(1500);
    const res = await visitor.request.get(`/api/test-outbox?to=${encodeURIComponent(stranger)}`);
    expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(0);

    // A made-up token is not a reset link.
    await visitor.goto("/reset-password?token=abcdefghijklmnopqrstuvwx");
    await expect(visitor.getByRole("heading", { name: "Link not valid" })).toBeVisible();
    await visitor.goto("/reset-password");
    await expect(visitor.getByRole("heading", { name: "Link not valid" })).toBeVisible();
    await anonymous.close();
  } finally {
    await forgetEmail(page);
  }
});

test("a new link replaces a leaked one at once", async ({ page, browser }) => {
  await page.goto("/hq/invites");
  const row = page.getByRole("listitem").filter({ hasText: memberName });
  await row.getByRole("button", { name: "Make a new link" }).click();
  await row.getByRole("button", { name: "Yes, replace it" }).click();
  await expect(row.getByRole("button", { name: "Make a new link" })).toBeVisible();

  const stale = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "cf-connecting-ip": "198.18.41.200" } });
  const old = await stale.newPage();
  await old.goto(memberLink);
  await expect(old.getByRole("heading", { name: "Invite link not valid" })).toBeVisible();
  await stale.close();

  // The member sees the new link on their own screen.
  await memberPage.goto("/invite");
  expect(await memberPage.getByLabel("Your invite link").inputValue()).not.toBe(memberLink);
});

test("only the admin can open /hq, and everyone else gets a plain not found", async ({ browser }) => {
  for (const path of ["/hq", "/hq/approvals", "/hq/invites", "/hq/members", "/hq/stats", "/hq/money", "/hq/money/payouts", "/hq/money/setup", "/hq/payments", "/hq/revenue"]) {
    const asMember = await memberPage.goto(path);
    expect(asMember?.status(), `member ${path}`).toBe(404);
  }

  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  for (const path of ["/hq", "/hq/approvals", "/hq/invites", "/hq/members", "/hq/stats", "/hq/money", "/hq/money/payouts", "/hq/money/setup", "/hq/payments", "/hq/revenue"]) {
    const res = await page.goto(path);
    expect(res?.status(), `signed out ${path}`).toBe(404);
  }
  await anonymous.close();

  // Only the admin has the Settings row.
  await memberPage.goto("/settings");
  await expect(memberPage.getByRole("link", { name: "Admin panel" })).toHaveCount(0);
  await expect(memberPage.getByRole("link", { name: "Moderation" })).toHaveCount(0);
});

test("the admin has an Admin panel row in Settings, and the panel is usable on a phone", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Admin panel" }).click();
  await expect(page).toHaveURL(/\/hq$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/invites");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("the admin makes a member a moderator, who gets the members list and the numbers and nothing else, and it can be taken back", async ({ page }) => {
  await page.goto("/hq/members");
  await page.getByLabel("Search members").fill("Hosta");
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("listitem").filter({ hasText: memberName });
  await expect(row).toBeVisible();
  // The admin sees the email and the person's numbers.
  await expect(row).toContainText("@example.com");
  await expect(row.locator("dl")).toContainText("Likes received");
  await row.getByRole("button", { name: `Make ${memberName} a moderator` }).click();
  await expect(row.getByText("Moderator", { exact: true })).toBeVisible();

  try {
    await memberPage.setViewportSize({ width: 412, height: 915 });
    await memberPage.goto("/settings");
    await memberPage.getByRole("link", { name: "Moderation" }).click();
    await expect(memberPage).toHaveURL(/\/hq\/members$/);
    await expect(memberPage.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    // A moderator sees no email addresses and has no buttons to make moderators.
    await expect(memberPage.getByText(/@example\.com/)).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: /moderator/i })).toHaveCount(0);
    // Measured against the phone's real width, not the page's own idea of it.
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
    expect((await memberPage.goto("/hq/stats"))?.status()).toBe(200);
    await expect(memberPage.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
    // /hq itself leads a moderator to the list, and every other admin page is still not found.
    await memberPage.goto("/hq");
    await expect(memberPage).toHaveURL(/\/hq\/members$/);
    for (const path of ["/hq/approvals", "/hq/invites", "/hq/branding", "/hq/email", "/hq/services", "/hq/money", "/hq/money/payouts", "/hq/money/setup", "/hq/payments", "/hq/revenue"]) {
      expect((await memberPage.goto(path))?.status(), path).toBe(404);
    }
  } finally {
    await page.goto("/hq/members");
    await page.getByLabel("Search members").fill("Hosta");
    await page.getByRole("button", { name: "Search" }).click();
    await row.getByRole("button", { name: `Remove ${memberName} as a moderator` }).click();
    await expect(row.getByRole("button", { name: `Make ${memberName} a moderator` })).toBeVisible();
  }

  // Taken back: the member is an ordinary member again.
  expect((await memberPage.goto("/hq/members"))?.status()).toBe(404);
  await memberPage.goto("/settings");
  await expect(memberPage.getByRole("link", { name: "Moderation" })).toHaveCount(0);
});
