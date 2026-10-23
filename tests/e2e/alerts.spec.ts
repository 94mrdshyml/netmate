import { expect, test } from "@playwright/test";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";

// Serial: later tests use the post and the members made by earlier ones.
test.describe.configure({ mode: "serial" });

const unique = () => `alerts ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const adminName = `${E2E.admin.firstName} ${E2E.admin.lastName}`;
/** The post itself on its page (the replies below are posts too, with their own buttons). */
const thePost = (page: import("@playwright/test").Page) => page.getByRole("article").filter({ hasText: postText }).first();
const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

let postText = "";
let postUrl = "";

// Sign-ups are limited to 20 per invite link in 10 minutes and every spec shares the admin's link,
// so this spec joins only twice. Alice stays signed in for the last test: nobody has acted on her.
let alice: Awaited<ReturnType<typeof signUpMember>>;
test.afterAll(async () => {
  await alice?.context.close();
});

test("a new alert shows a count on the Alerts tab, and opening Alerts lists it and clears the count", async ({ browser, page }) => {
  // The admin writes a post.
  postText = unique();
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(postText);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("article").filter({ hasText: postText }).getByRole("link", { name: /^Reply/ }).click();
  await expect(page).toHaveURL(/\/status\/post_/);
  postUrl = new URL(page.url()).pathname;

  // A new member (who joined with the admin's link) likes it, follows the admin, and replies.
  alice = await signUpMember(browser, "198.18.50.1", { first: "Alice", last: "Admirer" });
  await alice.page.goto(postUrl);
  await thePost(alice.page).getByRole("button", { name: /^Like, / }).click();
  await expect(thePost(alice.page).getByRole("button", { name: /^Unlike, / })).toBeEnabled();
  await alice.page.goto(`/${E2E.admin.username}`);
  await alice.page.getByRole("button", { name: `Follow ${adminName}` }).click();
  await expect(alice.page.getByRole("button", { name: `Following ${adminName}. Tap to unfollow` })).toBeEnabled();
  await alice.page.goto(postUrl);
  await alice.page.getByPlaceholder("Write your reply").fill("Great post!");
  await alice.page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(alice.page.getByRole("region", { name: "Replies" })).toContainText("Great post!");

  // The admin sees a count on the tab, with an accessible name that says so.
  await page.goto("/");
  const alertsTab = nav(page).getByRole("link", { name: /^Alerts, \d+ unread$/ });
  await expect(alertsTab).toBeVisible();
  const box = (await alertsTab.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  await alertsTab.click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  const list = page.getByRole("list", { name: "Alerts" });
  await expect(list).toContainText("Alice Admirer liked your post");
  await expect(list).toContainText("Alice Admirer followed you");
  await expect(list).toContainText("Alice Admirer replied to your post");
  await expect(list).toContainText("Alice Admirer joined with your invite link");
  // The post and the reply show as short snippets.
  await expect(list).toContainText(postText);
  await expect(list).toContainText("Great post!");
  // They are marked new on first sight, and the count hides while on this screen.
  await expect(page.locator(".alert-unread").first()).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Alerts", exact: true })).toBeVisible();

  // Opening the screen marked everything read: after a reload Alice's alerts are no longer new.
  // (Other specs may add alerts for the admin at the same time, so only Alice's are checked.)
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Alice Admirer" }).first()).toBeVisible();
  await expect(page.locator(".alert-unread").filter({ hasText: "Alice Admirer" })).toHaveCount(0);
});

test("likes of one post from several people become one line, and an unlike takes its alert back", async ({ browser, page }) => {
  const bob = await signUpMember(browser, "198.18.50.2", { first: "Bob", last: "Bystander" });
  await bob.page.goto(postUrl);
  await thePost(bob.page).getByRole("button", { name: /^Like, / }).click();
  await expect(thePost(bob.page).getByRole("button", { name: /^Unlike, / })).toBeEnabled();

  await page.goto("/notifications");
  // Bob's like joins Alice's: one line for the post, newest name first.
  await expect(page.getByRole("list", { name: "Alerts" })).toContainText("Bob Bystander and Alice Admirer liked your post");
  await expect(page.getByRole("listitem").filter({ hasText: postText })).toHaveCount(1);

  // He takes it back and only Alice's remains.
  await thePost(bob.page).getByRole("button", { name: /^Unlike, / }).click();
  await expect(thePost(bob.page).getByRole("button", { name: /^Like, / })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("list", { name: "Alerts" })).toContainText("Alice Admirer liked your post");
  await expect(page.getByRole("list", { name: "Alerts" })).not.toContainText("Bob Bystander and");
  await bob.context.close();
});

test("tapping an alert opens the post or the person", async ({ page }) => {
  await page.goto("/notifications");
  await page.getByRole("link", { name: /Alice Admirer liked your post/ }).click();
  await expect(page).toHaveURL(new RegExp(`${postUrl}$`));
  await expect(page.getByRole("article").filter({ hasText: postText })).toBeVisible();

  await page.goto("/notifications");
  await page.getByRole("link", { name: /Alice Admirer followed you/ }).click();
  await expect(page).toHaveURL(/\/m_[0-9a-z]+$/);
  await expect(page.getByRole("heading", { name: "Alice Admirer" })).toBeVisible();
});

test("a member nobody has acted on sees a friendly empty screen, and cannot see anyone else's alerts", async () => {
  await alice.page.goto("/notifications");
  await expect(alice.page.getByText("No alerts yet.")).toBeVisible();
  // No list at all, and nothing about the admin's alerts (which name Alice and Bob) shows up for her.
  await expect(alice.page.getByRole("list", { name: "Alerts" })).toHaveCount(0);
  await expect(alice.page.getByText("Bob Bystander")).toHaveCount(0);
  await expect(alice.page.getByText(/liked your post|followed you|replied to your post/)).toHaveCount(0);
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

// Alice is the one regular member this spec has, so Settings for a member who is not the admin is checked here.
test("a regular member's Settings has no Admin panel", async () => {
  await alice.page.goto("/");
  await alice.page.getByRole("link", { name: /^Settings, signed in as @/ }).click();
  const list = alice.page.getByRole("list", { name: "Settings" });
  await expect(list.getByRole("link", { name: /^Edit profile/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /^Invite people/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /^Admin panel/ })).toHaveCount(0);
});

test("a signed-out visitor is sent to sign in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});
