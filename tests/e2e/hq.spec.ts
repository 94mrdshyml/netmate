import { expect, test, type Browser, type Page } from "@playwright/test";
import { signUpMember } from "./helpers";

// Serial: each step uses what the one before made. The invite quota is an instance setting other
// files depend on, so it is never changed to anything but its default here. The member's five
// automatic approvals are used up instead, so the next sign-ups through their link wait.
test.describe.configure({ mode: "serial" });

let nextVisitor = 0;
let memberPage: Page;
let closeMember: () => Promise<void>;
let memberName = "";
let memberLink = "";

/** A visitor with no session, from an address of their own, who opens a link and signs up. */
async function joinThrough(browser: Browser, link: string, last: string) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": `198.18.41.${++nextVisitor}` },
  });
  const page = await context.newPage();
  await page.goto(link);
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
    await expect(filler.page).toHaveURL(/\/$/);
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
  for (const path of ["/hq", "/hq/approvals", "/hq/invites"]) {
    const asMember = await memberPage.goto(path);
    expect(asMember?.status(), `member ${path}`).toBe(404);
  }

  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  for (const path of ["/hq", "/hq/approvals", "/hq/invites"]) {
    const res = await page.goto(path);
    expect(res?.status(), `signed out ${path}`).toBe(404);
  }
  await anonymous.close();

  // Only the admin has the Settings row.
  await memberPage.goto("/settings");
  await expect(memberPage.getByRole("link", { name: "Admin panel" })).toHaveCount(0);
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
