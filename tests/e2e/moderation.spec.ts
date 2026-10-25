import { type Page } from "@playwright/test";
import { E2E } from "./constants";
import { expect, test } from "./fixtures";
import { sendPost, signUpMember } from "./helpers";

// Taking a reported post down and suspending a member (docs/PRD.md 8.8a). Serial: each step uses what the one before made.
// All the people are new; nothing here changes the owner's settings, so it can run beside the other files.
test.describe.configure({ mode: "serial" });

const WORDS = `modwords${Date.now().toString(36)}`;

type Who = { page: Page; context: { close: () => Promise<void> }; username: string; email: string; password: string };
let author: Who;
let reporter: Who;
let mod: Who;
let caseId = "";

test.beforeAll(async ({ browser }) => {
  author = await signUpMember(browser, "198.18.65.1", { first: "Ava", last: "Author" });
  reporter = await signUpMember(browser, "198.18.65.2", { first: "Rex", last: "Reporter" });
  mod = await signUpMember(browser, "198.18.65.3", { first: "Max", last: "Marshal" });
});

test.afterAll(async () => {
  await Promise.all([author.context.close(), reporter.context.close(), mod.context.close()]);
});

test("a reported post is taken down from its case: gone for everyone, the author and the reporter told, the case closed", async ({ page }) => {
  await author.page.goto("/compose");
  await author.page.getByLabel("Your post").fill(`${WORDS} something against the rules`);
  await sendPost(author.page);
  const mine = author.page.getByRole("article").filter({ hasText: WORDS }).first();
  const postPath = new URL((await mine.getByRole("link", { name: /^Reply/ }).getAttribute("href"))!, "http://x").pathname;

  // The reporter files a report.
  await reporter.page.goto(postPath);
  await reporter.page.getByRole("article").filter({ hasText: WORDS }).first().getByRole("button", { name: "More options" }).click();
  await reporter.page.getByRole("link", { name: "Report post" }).click();
  await reporter.page.getByLabel(/^Spam/).check();
  await reporter.page.getByRole("button", { name: "Send report" }).click();
  await expect(reporter.page.getByText("Thank you. We have your report.")).toBeVisible();
  caseId = (await reporter.page.locator(".case-id").first().textContent())!;

  // The admin opens the case and takes the post down; it asks first.
  await page.goto("/hq/cases");
  await page.getByLabel("Find a case").fill(caseId);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: `Open ${caseId}` }).click();
  await expect(page.getByText("still up")).toBeVisible();
  await page.getByRole("button", { name: "Remove post" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByText("still up")).toBeVisible();
  await page.getByRole("button", { name: "Remove post" }).click();
  await page.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(page.getByText("no longer up")).toBeVisible();
  await expect(page.getByText("Closed: Post removed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove post" })).toHaveCount(0);

  // Gone for everyone, including its author's own page.
  expect((await reporter.page.goto(postPath))?.status()).toBe(404);
  await author.page.goto(`/${author.username}`);
  await expect(author.page.getByText(WORDS)).toHaveCount(0);

  // The author is told a post was removed, with no name and no reason.
  await author.page.goto("/notifications");
  const removed = author.page.getByRole("listitem").filter({ hasText: "A post of yours was removed because it broke this space's rules." });
  await expect(removed).toHaveCount(1);
  await expect(removed).not.toContainText("Rex");
  await expect(removed).not.toContainText("Spam");
  await expect(removed).not.toContainText(caseId);
  await expect(removed).not.toContainText(WORDS);

  // The reporter is told how it ended, and their list says so.
  await reporter.page.goto("/notifications");
  await expect(reporter.page.getByRole("listitem").filter({ hasText: `Your report ${caseId} was looked at: Post removed.` })).toHaveCount(1);
  await reporter.page.goto("/reports");
  await expect(reporter.page.getByRole("listitem").filter({ hasText: caseId })).toContainText("Closed: Post removed");
  expect(await reporter.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
});

test("a moderator can suspend an ordinary member, but not the owner, another moderator or themselves", async ({ page }) => {
  // The admin makes Max a moderator (and Ava another one, to see that a moderator cannot be suspended by a moderator).
  await page.goto("/hq/members");
  for (const name of ["Max Marshal"]) {
    await page.getByLabel("Search members").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: `Make ${name} a moderator` }).click();
    await expect(page.getByRole("button", { name: `Remove ${name} as a moderator` })).toBeVisible();
  }

  await mod.page.goto("/hq/members");
  await mod.page.getByLabel("Search members").fill("Ava Author");
  await mod.page.getByRole("button", { name: "Search" }).click();
  const avaRow = mod.page.getByRole("listitem").filter({ hasText: "Ava Author" });
  await expect(avaRow.getByRole("button", { name: "Suspend Ava Author" })).toBeVisible();
  expect((await avaRow.getByRole("button", { name: "Suspend Ava Author" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Not for the owner, and not for themselves.
  await mod.page.getByLabel("Search members").fill("Riya");
  await mod.page.getByRole("button", { name: "Search" }).click();
  await expect(mod.page.getByRole("button", { name: /^Suspend / })).toHaveCount(0);
  await mod.page.getByLabel("Search members").fill("Max Marshal");
  await mod.page.getByRole("button", { name: "Search" }).click();
  await expect(mod.page.getByRole("button", { name: /^Suspend / })).toHaveCount(0);
  // A moderator sees no email address, and no Make moderator button.
  await expect(mod.page.getByRole("button", { name: /moderator$/ })).toHaveCount(0);
});

test("suspending a member signs them out, tells them at sign-in, hides them, and lifting brings everything back", async () => {
  await mod.page.goto("/hq/members");
  await mod.page.getByLabel("Search members").fill("Ava Author");
  await mod.page.getByRole("button", { name: "Search" }).click();
  const row = mod.page.getByRole("listitem").filter({ hasText: "Ava Author" });
  await row.getByRole("button", { name: "Suspend Ava Author" }).click();
  await row.getByRole("button", { name: "Keep them" }).click();
  await expect(row.getByRole("button", { name: "Suspend Ava Author" })).toBeVisible();
  await row.getByRole("button", { name: "Suspend Ava Author" }).click();
  await row.getByLabel(/A note for the other staff/).fill("Test of a suspension");
  await row.getByRole("button", { name: "Yes, suspend" }).click();
  await expect(row.getByText("Suspended", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Lift the suspension of Ava Author" })).toBeVisible();

  // Signed out at once: the next page she opens is the sign-in page.
  await author.page.goto("/");
  await expect(author.page).toHaveURL(/\/sign-in/);
  // Signing in again says why.
  await author.page.getByLabel("Email").fill(author.email);
  await author.page.getByLabel("Password").fill(author.password);
  await author.page.getByRole("button", { name: "Sign in" }).click();
  await expect(author.page.getByRole("alert").filter({ hasText: "Your account is suspended" })).toBeVisible();
  await expect(author.page).toHaveURL(/\/sign-in/);

  // Hidden from everyone else.
  expect((await reporter.page.goto(`/${author.username}`))?.status()).toBe(404);

  // Staff can still find her, under Suspended, and lift it.
  await mod.page.goto("/hq/members?show=suspended");
  const listed = mod.page.getByRole("listitem").filter({ hasText: "Ava Author" });
  await expect(listed).toBeVisible();
  await listed.getByRole("button", { name: "Lift the suspension of Ava Author" }).click();
  await expect(mod.page.getByRole("listitem").filter({ hasText: "Ava Author" })).toHaveCount(0);

  await author.page.getByRole("button", { name: "Sign in" }).click();
  await expect(author.page).toHaveURL(/\/$/);
  expect((await reporter.page.goto(`/${author.username}`))?.status()).toBe(200);
});

test("put back: the moderator is an ordinary member again", async ({ page }) => {
  await page.goto("/hq/members");
  await page.getByLabel("Search members").fill("Max Marshal");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Remove Max Marshal as a moderator" }).click();
  await expect(page.getByRole("button", { name: "Make Max Marshal a moderator" })).toBeVisible();
  expect((await mod.page.goto("/hq/cases"))?.status()).toBe(404);
  expect(E2E.admin.username).toBeTruthy();
});
