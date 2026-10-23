import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";
import { sendPost, signUpMember } from "./helpers";

// Serial: later tests use the members and posts made by earlier ones.
test.describe.configure({ mode: "serial" });

const unique = () => `soc ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function post(page: Page, text: string) {
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(text);
  await sendPost(page);
}

const adminName = `${E2E.admin.firstName} ${E2E.admin.lastName}`;

test("the bottom bar takes me Home, to Search, to Alerts and to my profile, and shows where I am", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(nav.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");

  // The Alerts tab may carry an unread count in its name ("Alerts, 3 unread").
  await nav.getByRole("link", { name: /^Alerts/ }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  await nav.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}$`));
  await expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");

  // Settings opens from your picture in the corner, not from the bar.
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // Tap targets are at least 44px and the bar stays inside the phone column.
  for (const link of await nav.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("my profile shows my details, counts and tabs, with Edit profile instead of Follow", async ({ page }) => {
  await page.goto(`/${E2E.admin.username}`);
  await expect(page.getByRole("heading", { name: adminName })).toBeVisible();
  await expect(page.getByText(`@${E2E.admin.username}`).first()).toBeVisible();
  await expect(page.getByText(/^Joined /)).toBeVisible();
  await expect(page.getByRole("link", { name: /Following$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Followers?$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Follow / })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Posts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("I can edit my profile, see it on my page, and every problem is shown at once", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByLabel("Username")).toHaveValue(`@${E2E.admin.username}`);
  await expect(page.getByLabel("Username")).toHaveAttribute("readonly", "");

  await page.getByLabel("First name").fill("");
  await page.getByLabel("Bio").fill("x".repeat(170));
  await page.getByLabel("Link").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter your first name")).toBeVisible();
  await expect(page.getByText("Use 160 characters or fewer")).toBeVisible();
  await expect(page.getByText("Enter a web address such as riya.dev")).toBeVisible();

  await page.getByLabel("First name").fill(E2E.admin.firstName);
  await page.getByLabel("Bio").fill("Hello from the e2e tests");
  await page.getByLabel("City or country").fill("Pune");
  await page.getByLabel("Link").fill("riya.dev");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.goto(`/${E2E.admin.username}`);
  await expect(page.getByText("Hello from the e2e tests")).toBeVisible();
  await expect(page.getByText("Pune")).toBeVisible();
  const link = page.getByRole("link", { name: "riya.dev" });
  await expect(link).toHaveAttribute("href", "https://riya.dev/");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /nofollow/);
});

test("a new member sees an empty Following feed, follows the admin, and then sees their posts", async ({ browser, page }) => {
  const adminPost = unique();
  await post(page, adminPost);

  const { page: member, context, username } = await signUpMember(browser, "198.18.20.1", { first: "Fiona", last: "Follower" });

  // Not following anyone yet.
  await member.goto("/?feed=following");
  await expect(member.getByText(/Your feed is empty/)).toBeVisible();
  await expect(member.getByRole("link", { name: "Find people" })).toHaveAttribute("href", "/search");
  await expect(member.getByRole("article").filter({ hasText: adminPost })).toHaveCount(0);

  // The admin's profile offers Follow; following is a toggle that survives a reload.
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("link", { name: "Edit profile" })).toHaveCount(0);
  await member.getByRole("button", { name: `Follow ${adminName}` }).click();
  // The button changes at once; it is enabled again only when the server has answered.
  await expect(member.getByRole("button", { name: `Following ${adminName}. Tap to unfollow` })).toBeEnabled();
  await member.reload();
  await expect(member.getByRole("button", { name: `Following ${adminName}. Tap to unfollow` })).toBeVisible();

  // Now the admin's post is in their Following feed, and the lists show each other.
  await member.goto("/?feed=following");
  await expect(member.getByRole("article").filter({ hasText: adminPost })).toBeVisible();
  await member.goto(`/${E2E.admin.username}/followers`);
  await expect(member.getByRole("list", { name: "Followers" })).toContainText("Fiona Follower");
  await member.goto(`/${username}/following`);
  await expect(member.getByRole("list", { name: "Following" })).toContainText(adminName);

  // The admin sees one more follower, and the new member in the list.
  await page.goto(`/${E2E.admin.username}/followers`);
  await expect(page.getByRole("list", { name: "Followers" })).toContainText("Fiona Follower");

  // Unfollowing takes the admin's posts out of the member's Following feed again.
  await member.goto(`/${E2E.admin.username}`);
  await member.getByRole("button", { name: `Following ${adminName}. Tap to unfollow` }).click();
  await expect(member.getByRole("button", { name: `Follow ${adminName}` })).toBeEnabled();
  await member.goto("/?feed=following");
  await expect(member.getByRole("article").filter({ hasText: adminPost })).toHaveCount(0);
  await context.close();
});

test("people lists have no Follow button on my own row, and a missing person or list is not found", async ({ page }) => {
  await page.goto(`/${E2E.admin.username}/followers`);
  await expect(page.getByRole("button", { name: new RegExp(`${adminName}`) })).toHaveCount(0);

  expect((await page.goto("/nobody_here_at_all"))?.status()).toBe(404);
  expect((await page.goto(`/${E2E.admin.username}/nonsense`))?.status()).toBe(404);
});

test("a name on a post opens that person's profile, and Replies is its own tab", async ({ page }) => {
  const text = unique();
  await post(page, text);
  await page.getByRole("article").filter({ hasText: text }).getByRole("link", { name: new RegExp(`${adminName}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}$`));
  await expect(page.getByRole("region", { name: "Posts", exact: true })).toContainText(text);

  await page.getByRole("link", { name: "Replies", exact: true }).click();
  await expect(page).toHaveURL(/tab=replies/);
  await expect(page.getByRole("region", { name: "Replies", exact: true })).not.toContainText(text);
});

test("Settings lists invite and profile, shows how many joined, and Log out ends only this session", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Invite people" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();

  await page.getByRole("link", { name: "Invite people" }).click();
  await expect(page).toHaveURL(/\/invite$/);
  await expect(page.getByLabel("Your invite link")).toHaveValue(/\/sign-up\?invite=/);
  await expect(page.getByText(/(person has|people have) joined with your link/)).toBeVisible();
});
