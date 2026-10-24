import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSignUpForm, signUpMember } from "./helpers";

// Serial: each step uses the members and state the one before made. Only Priya joins through the
// admin's link: a whole run may sign up 20 people through it, and the other specs use most of those.
// Sam and a stranger join through Priya's own link, which has a count of its own.
test.describe.configure({ mode: "serial" });

type Who = { page: Page; username: string; close: () => Promise<void> };
let priya: Who;
let sam: Who;
let stranger: Who;
const POST = `private words ${Date.now().toString(36)}`;
const PRIYA = "Priya Private";
const SAM = "Sam Seeker";

async function joinAdmin(browser: Browser, ip: string, first: string, last: string): Promise<Who> {
  const m = await signUpMember(browser, ip, { first, last });
  return { page: m.page, username: m.username, close: () => m.context.close() };
}

/** Signs up through a member's link, from an address of its own. */
async function joinThrough(browser: Browser, link: string, ip: string, first: string, last: string): Promise<Who> {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  const page = await context.newPage();
  await openSignUpForm(page, link);
  const stamp = `${Date.now().toString(36)}${first.slice(0, 1).toLowerCase()}`;
  const username = `p_${stamp}`.slice(0, 15);
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("a-long-enough-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  // Hashing a password is slow when the machine is busy, so allow more than the default 5 seconds.
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  return { page, username, close: () => context.close() };
}

test.beforeAll(async ({ browser }) => {
  priya = await joinAdmin(browser, "198.18.70.1", "Priya", "Private");
  await priya.page.goto("/invite");
  const link = await priya.page.getByLabel("Your invite link").inputValue();
  sam = await joinThrough(browser, link, "198.18.70.2", "Sam", "Seeker");
  stranger = await joinThrough(browser, link, "198.18.70.3", "Stan", "Stranger");
  await priya.page.goto("/compose");
  await priya.page.getByLabel("Your post").fill(POST);
  await priya.page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(priya.page).toHaveURL(/\/$/);
});

test.afterAll(async () => {
  await priya.close();
  await sam.close();
  await stranger.close();
});

const feedHas = async (page: Page, feed: "" | "?feed=following") => {
  await page.goto(`/${feed}`);
  await expect(page.getByRole("navigation", { name: "Feeds" })).toBeVisible();
  return (await page.getByText(POST).count()) > 0;
};

test("Settings has a Privacy screen with a private account switch, and the choice is kept", async () => {
  const page = priya.page;
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Privacy/ }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();

  const list = page.getByRole("list", { name: "Privacy" });
  await expect(list.getByRole("link", { name: /^Follow requests/ })).toContainText("Nobody is waiting");
  await expect(list.getByRole("link", { name: /^Blocked people/ })).toContainText("Nobody blocked");
  await expect(list.getByRole("link", { name: /^Muted people/ })).toContainText("Nobody muted");

  const toggle = page.getByRole("switch", { name: "Private account" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("status").filter({ hasText: "Your account is private." })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: "Private account" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a private profile shows only its header; asking to follow shows Requested", async () => {
  const page = sam.page;
  await page.goto(`/${priya.username}`);
  await expect(page.getByRole("heading", { name: PRIYA })).toBeVisible();
  await expect(page.getByText("This account is private.")).toBeVisible();
  await expect(page.getByText(POST)).toHaveCount(0);
  // The lists are for followers, so the counts are plain numbers.
  await expect(page.getByRole("link", { name: /Followers?$/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Profile sections" })).toHaveCount(0);

  await page.getByRole("button", { name: `Follow ${PRIYA}` }).click();
  await expect(page.getByRole("button", { name: `Requested to follow ${PRIYA}. Tap to cancel` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: `Requested to follow ${PRIYA}. Tap to cancel` })).toContainText("Requested");
  await expect(page.getByText("Your request is waiting for an answer.")).toBeVisible();

  // Asking does not open the posts, anywhere.
  expect(await feedHas(page, "")).toBe(false);
  await page.goto(`/${priya.username}/followers`);
  await expect(page.getByText("This account is private.")).toBeVisible();

  // A stranger sees the same lock.
  await stranger.page.goto(`/${priya.username}`);
  await expect(stranger.page.getByText("This account is private.")).toBeVisible();
  await expect(stranger.page.getByText(POST)).toHaveCount(0);
});

test("the owner sees the request as an alert and answers it in Follow requests", async () => {
  const page = priya.page;
  await page.goto("/notifications");
  const row = page.getByRole("listitem").filter({ hasText: `${SAM} asked to follow you` });
  await expect(row).toBeVisible();
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/privacy\/requests$/);

  await expect(page.getByRole("listitem").filter({ hasText: SAM })).toBeVisible();
  await page.getByRole("button", { name: `Approve ${SAM}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();

  await page.goto("/privacy");
  await expect(page.getByRole("link", { name: /^Follow requests/ })).toContainText("Nobody is waiting");
  // The alert goes once it is answered.
  await page.goto("/notifications");
  await expect(page.getByText(`${SAM} asked to follow you`)).toHaveCount(0);
});

test("an approved follower sees the posts, and the lists", async () => {
  const page = sam.page;
  await page.goto(`/${priya.username}`);
  await expect(page.getByText(POST)).toBeVisible();
  await expect(page.getByRole("button", { name: `Following ${PRIYA}. Tap to unfollow` })).toBeVisible();
  await expect(page.getByRole("link", { name: /Followers?$/ })).toBeVisible();
  expect(await feedHas(page, "?feed=following")).toBe(true);

  // Still locked for everyone else.
  await stranger.page.goto(`/${priya.username}`);
  await expect(stranger.page.getByText(POST)).toHaveCount(0);
});

test("muting hides a person from Home and alerts, not from their profile, and can be undone", async () => {
  const page = sam.page;
  await page.goto(`/${priya.username}`);
  await page.getByRole("button", { name: `More options for ${PRIYA}` }).click();
  await page.getByRole("button", { name: `Mute @${priya.username}`, exact: true }).click();
  await expect(page.getByText("You muted this person.")).toBeVisible();
  await expect(page.getByText(POST)).toBeVisible(); // their own page still shows them

  expect(await feedHas(page, "")).toBe(false);
  expect(await feedHas(page, "?feed=following")).toBe(false);

  await page.goto("/privacy/muted");
  const row = page.getByRole("listitem").filter({ hasText: PRIYA });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Unmute ${PRIYA}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unmuted" })).toBeVisible();
  expect(await feedHas(page, "")).toBe(true);
});

test("blocking asks first, hides both people from each other, and unblocking brings the profile back", async () => {
  const page = sam.page;
  await page.goto(`/${priya.username}`);
  await page.getByRole("button", { name: `More options for ${PRIYA}` }).click();
  await page.getByRole("button", { name: `Block @${priya.username}`, exact: true }).click();
  // Asked once more, and cancelling leaves everything as it was.
  await expect(page.getByRole("group", { name: `Block @${priya.username}?` })).toContainText("They are not told");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: `Block @${priya.username}`, exact: true }).click();
  await page.getByRole("group", { name: `Block @${priya.username}?` }).getByRole("button", { name: "Block", exact: true }).click();

  await expect(page.getByText(`You blocked @${priya.username}.`)).toBeVisible();
  await expect(page.getByText(POST)).toHaveCount(0);
  expect(await feedHas(page, "")).toBe(false);

  // The other person cannot see the blocker, and is not told why.
  await priya.page.goto(`/${sam.username}`);
  await expect(priya.page.getByText("You cannot see this profile.")).toBeVisible();
  await expect(priya.page.getByText(/blocked/i)).toHaveCount(0);
  for (const [who, other, name] of [[sam.page, priya, "Priya"], [priya.page, sam, "Sam"]] as const) {
    await who.goto(`/search?q=${name}&tab=people`);
    await expect(who.getByRole("navigation", { name: "Search results" })).toBeVisible();
    await expect(who.getByRole("link", { name: new RegExp(`@${other.username}`) })).toHaveCount(0);
  }
  // A person who blocked nobody and was not blocked still finds Priya.
  await stranger.page.goto(`/search?q=Priya&tab=people`);
  await expect(stranger.page.getByRole("link", { name: new RegExp(`@${priya.username}`) })).toBeVisible();

  // It is listed, and can be undone. The follow does not come back by itself.
  await page.goto("/privacy/blocked");
  const row = page.getByRole("listitem").filter({ hasText: PRIYA });
  await row.getByRole("button", { name: `Unblock ${PRIYA}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unblocked" })).toBeVisible();
  await page.goto(`/${priya.username}`);
  await expect(page.getByText("This account is private.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Follow ${PRIYA}` })).toBeVisible();
});

test("turning private off approves everyone who is waiting", async () => {
  await sam.page.goto(`/${priya.username}`);
  await sam.page.getByRole("button", { name: `Follow ${PRIYA}` }).click();
  await expect(sam.page.getByRole("button", { name: `Requested to follow ${PRIYA}. Tap to cancel` })).toBeVisible();

  const page = priya.page;
  await page.goto("/privacy");
  await expect(page.getByRole("link", { name: /^Follow requests/ })).toContainText("1 person is waiting");
  await expect(page.getByText("Turning this off approves the 1 person waiting.")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Private account" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("status").filter({ hasText: "Your account is public." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /^Follow requests/ })).toContainText("Nobody is waiting");

  await sam.page.goto(`/${priya.username}`);
  await expect(sam.page.getByRole("button", { name: `Following ${PRIYA}. Tap to unfollow` })).toBeVisible();
  await expect(sam.page.getByText(POST)).toBeVisible();
});

test("everything in Privacy fits a phone and the pages are for signed-in members only", async ({ browser }) => {
  for (const path of ["/privacy", "/privacy/requests", "/privacy/blocked", "/privacy/muted"]) {
    await priya.page.goto(path);
    expect(await priya.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto("/privacy");
  await expect(visitor).toHaveURL(/\/sign-in/);
  await anonymous.close();
});
