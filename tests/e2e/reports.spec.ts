import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sendPost, signUpMember } from "./helpers";

// Serial: the member's report is worked by the admin in the steps after it. One admin post and one new member.
test.describe.configure({ mode: "serial" });

const stamp = `report ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let member: Page;
let closeMember: () => Promise<void>;
let postPath = "";
let caseId = "";

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.60.1", { first: "Rita", last: "Reporter" });
  member = m.page;
  closeMember = () => m.context.close();
});

test.afterAll(async () => {
  await closeMember();
});

test("a member reports an admin post: choose a reason, get a case number, and see it in Your reports", async ({ page }) => {
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(`${stamp} a post somebody objects to`);
  await sendPost(page);

  // The admin's own post has a menu with Delete, and nothing to report.
  const mine = page.getByRole("article").filter({ hasText: stamp }).first();
  await mine.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("link", { name: "Report post" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete post" })).toBeVisible();
  postPath = new URL((await mine.getByRole("link", { name: /^Reply/ }).getAttribute("href"))!, "http://x").pathname;

  await member.goto(postPath);
  const theirs = member.getByRole("article").filter({ hasText: stamp }).first();
  const more = theirs.getByRole("button", { name: "More options" });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await member.getByRole("link", { name: "Report post" }).click();
  await expect(member).toHaveURL(/\/report\/post_/);
  await expect(member.getByRole("heading", { name: "Report a post", level: 1 })).toBeVisible();
  await expect(member.getByText(stamp)).toBeVisible();

  // Nothing chosen yet: it says so and sends nothing.
  await member.getByRole("button", { name: "Send report" }).click();
  await expect(member.getByRole("alert").filter({ hasText: "Choose what is wrong" })).toBeVisible();

  // The options are easy to hit, and "Something else" needs a few words.
  for (const option of await member.locator(".report-option").all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await member.getByLabel(/Something else/).check();
  await member.getByRole("button", { name: "Send report" }).click();
  await expect(member.getByRole("alert").filter({ hasText: "Tell us what is wrong" })).toBeVisible();

  await member.getByLabel(/^Spam/).check();
  await member.getByLabel(/Anything else/).fill("Looks like an advert");
  await member.getByRole("button", { name: "Send report" }).click();
  await expect(member.getByText("Thank you. We have your report.")).toBeVisible();
  caseId = (await member.locator(".case-id").first().textContent())!;
  expect(caseId).toMatch(/^CASE-\d{6}$/);
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  // Reporting it again gives the same case back.
  await member.goto(`/report/${postPath.split("/").pop()}`);
  await member.getByLabel(/^Hate/).check();
  await member.getByRole("button", { name: "Send report" }).click();
  await expect(member.getByText("You already reported this")).toBeVisible();
  await expect(member.locator(".case-id").first()).toHaveText(caseId);

  await member.goto("/settings");
  await member.getByRole("link", { name: /^Your reports/ }).click();
  const row = member.getByRole("listitem").filter({ hasText: caseId });
  await expect(row).toContainText("Spam");
  await expect(row).toContainText("Waiting");
  await expect(row).toContainText(stamp);
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
});

test("you cannot report your own post, and an ordinary member has no cases page", async ({ page }) => {
  const id = postPath.split("/").pop()!;
  expect((await page.goto(`/report/${id}`))?.status()).toBe(404);
  expect((await member.goto("/hq/cases"))?.status()).toBe(404);
  expect((await member.goto("/report/post_000000000000000000000000"))?.status()).toBe(404);
});

test("the admin finds the case, takes it, closes it, and the member sees where it ended", async ({ page }) => {
  await page.goto("/hq");
  await expect(page.getByRole("link", { name: /Reports/ })).toBeVisible();

  await page.goto("/hq/cases");
  const row = page.getByRole("listitem").filter({ hasText: caseId });
  await expect(row).toContainText("Spam");
  await expect(row).toContainText("Rita Reporter");

  // A number finds it, spelled however someone types it.
  await page.getByLabel("Find a case").fill(caseId.toLowerCase().replace("-", " "));
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: `Open ${caseId}` }).click();

  await expect(page.getByRole("heading", { name: caseId, level: 1 })).toBeVisible();
  await expect(page.getByText(`${stamp} a post somebody objects to`)).toBeVisible();
  await expect(page.getByText("Looks like an advert")).toBeVisible();
  await expect(page.getByText("Rita Reporter (@")).toBeVisible();

  await page.getByRole("button", { name: "Take this case" }).click();
  await expect(page.getByRole("button", { name: "Take this case" })).toHaveCount(0);
  await expect(page.getByText("Taken for review")).toBeVisible();

  await page.getByLabel("Handled", { exact: true }).check();
  await page.getByLabel(/A note for the other staff/).fill("Spoke to them");
  await page.getByRole("button", { name: "Close case" }).click();
  await expect(page.getByText("Spoke to them")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open this case again" })).toBeVisible();

  await member.goto("/reports");
  const mine = member.getByRole("listitem").filter({ hasText: caseId });
  await expect(mine).toContainText("Closed: Handled");
  // The staff note is theirs alone.
  await expect(member.getByText("Spoke to them")).toHaveCount(0);

  // Opened again, it goes back to waiting; the closed list no longer has it.
  await page.getByRole("button", { name: "Open this case again" }).click();
  await expect(page.getByRole("button", { name: "Take this case" })).toBeVisible();
  await member.goto("/reports");
  await expect(member.getByRole("listitem").filter({ hasText: caseId })).toContainText("Waiting");
});

test("the cases pages fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/hq/cases", "/hq/cases?show=closed"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  await page.goto("/hq/cases");
  await page.getByRole("link", { name: `Open ${caseId}` }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
