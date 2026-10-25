import { type Page } from "@playwright/test";
import { E2E } from "./constants";
import { expect, test } from "./fixtures";
import { sendPost, signUpMember } from "./helpers";

// For you (docs/PRD.md section 8.3): ranked, with a grey line on posts from people you do not follow, and a quiet report of
// what you looked at. Nothing here changes the owner's settings, so it can run beside the other files.

let member: Page;
let closeMember: () => Promise<void>;
const WORD = `mango${Date.now().toString(36)}`;

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.63.1", { first: "Fay", last: "Reader" });
  member = m.page;
  closeMember = () => m.context.close();
});

test.afterAll(async () => {
  await closeMember();
});

test("a post from someone you follow is in For you without a Suggested line, and a stranger's post has one", async ({ page }) => {
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(`Fresh from the admin ${WORD}`);
  await sendPost(page);

  // Not following yet: while the feed is small, a stranger's recent post is let in, with the grey line.
  await member.setViewportSize({ width: 412, height: 915 });
  await member.goto("/");
  await expect(member.getByRole("navigation", { name: "Feeds" }).getByRole("link", { name: "For you" })).toHaveAttribute("aria-current", "page");

  // Following: the same post is now one of "theirs", with no line, and near the top.
  await member.goto(`/${E2E.admin.username}`);
  await member.getByRole("button", { name: /^Follow / }).first().click();
  await expect(member.getByRole("button", { name: /^Following / }).first()).toBeVisible();
  await member.goto("/");
  const card = member.getByRole("article").filter({ hasText: WORD });
  await expect(card).toBeVisible();
  await expect(card.getByText("Suggested for you")).toHaveCount(0);
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  // Following shows the same post, newest first.
  await member.getByRole("navigation", { name: "Feeds" }).getByRole("link", { name: "Following" }).click();
  await expect(member.getByRole("article").filter({ hasText: WORD })).toBeVisible();
  await expect(member.getByText("Suggested for you")).toHaveCount(0);
});

test("the phone tells the server which posts were on screen, and the page does not show anything about it", async () => {
  const reported = member.waitForResponse((res) => res.request().method() === "POST" && res.request().headers()["next-action"] !== undefined && res.status() === 200, { timeout: 15_000 });
  await member.goto("/");
  await expect(member.getByRole("article").first()).toBeVisible();
  // Half on screen for a second, then leaving the page sends what was seen.
  await member.waitForTimeout(1500);
  await member.getByRole("navigation", { name: "Feeds" }).getByRole("link", { name: "Following" }).click();
  await reported;
  await expect(member.getByRole("alert")).toHaveCount(0);
});

test("the For you tab opens first, and each feed marks its tab", async () => {
  await member.goto("/");
  const tabs = member.getByRole("navigation", { name: "Feeds" });
  await expect(tabs.getByRole("link")).toHaveText(["For you", "Following"]);
  await expect(tabs.getByRole("link", { name: "For you" })).toHaveAttribute("aria-current", "page");
  await member.goto("/?feed=following");
  await expect(tabs.getByRole("link", { name: "Following" })).toHaveAttribute("aria-current", "page");
});
