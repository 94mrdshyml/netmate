import { expect, test } from "@playwright/test";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";

// Serial: the people tests use the member made by an earlier one.
test.describe.configure({ mode: "serial" });

// Random letters first, so the start of one word never matches another.
const word = () => `q${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
const adminName = `${E2E.admin.firstName} ${E2E.admin.lastName}`;

// One new member does the posting and is also the person People finds. Sign-ups are limited to 20 per
// invite link in 10 minutes and every spec shares the admin's link, so this spec joins only once.
let zephyrine: Awaited<ReturnType<typeof signUpMember>>;
test.beforeAll(async ({ browser }) => {
  zephyrine = await signUpMember(browser, "198.18.40.1", { first: "Zephyrine", last: "Quillfeather" });
});
test.afterAll(async () => {
  await zephyrine?.context.close();
});

test("the bottom bar opens Search, which suggests people while the box is empty", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Suggested for you" })).toBeVisible();

  // The box is at least 44px tall and the page does not scroll sideways.
  const box = (await page.getByRole("searchbox", { name: "Search posts and people" }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

// These tests post as members of their own: posting is limited to 10 a minute per person, and the
// admin's allowance is shared with every other spec.
test("posts appear while I type, with no button pressed, and the clear button empties the box", async () => {
  const { page } = zephyrine;
  const mine = word();
  const other = word();
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(`Coffee talk ${mine}`);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(`Something else ${other}`);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/search");
  const field = page.getByRole("searchbox", { name: "Search posts and people" });

  // One letter is too short; the screen says so and shows no results.
  await field.fill("z");
  await expect(page.getByText("Type at least 2 letters or numbers.")).toBeVisible();

  // The start of a word is enough, and only the matching post shows.
  await field.fill(mine.slice(0, 5));
  const results = page.getByRole("region", { name: "Posts", exact: true });
  await expect(results.getByRole("article").filter({ hasText: mine })).toBeVisible();
  await expect(results.getByRole("article").filter({ hasText: other })).toHaveCount(0);
  await expect(page).toHaveURL(/q=/);

  // Several words must all match.
  await field.fill(`coffee ${mine}`);
  await expect(results.getByRole("article").filter({ hasText: mine })).toBeVisible();
  await field.fill(`tea ${mine}`);
  await expect(page.getByText(/No posts found/)).toBeVisible();

  // Search syntax typed in is just text.
  await field.fill('coffee OR "');
  await expect(page.getByText(/No posts found/)).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Suggested for you" })).toBeVisible();
  await expect(page).toHaveURL(/\/search$/);
});

test("Enter works, a deleted post disappears from results, and a missing word says so", async () => {
  const { page } = zephyrine;
  const mine = word();
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(`Delete me ${mine}`);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search posts and people" }).fill(mine);
  await page.keyboard.press("Enter");
  const article = page.getByRole("article").filter({ hasText: mine });
  await expect(article).toBeVisible();

  await article.getByRole("button", { name: "Delete post" }).click();
  await article.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(article).toHaveCount(0);
  await page.goto(`/search?q=${mine}`);
  await expect(page.getByText(/No posts found/)).toBeVisible();
});

test("People finds a member by name or @username, ranks them, and Follow works from the results", async ({ page }) => {
  const { username } = zephyrine;

  await page.goto("/search");
  const field = page.getByRole("searchbox", { name: "Search posts and people" });
  await field.fill("zephyr");
  await page.getByRole("navigation", { name: "Search results" }).getByRole("link", { name: "People" }).click();
  const people = page.getByRole("list", { name: "People" });
  await expect(people).toContainText("Zephyrine Quillfeather");
  await expect(people).toContainText(`@${username}`);
  await expect(page).toHaveURL(/tab=people/);

  // A leading @ opens People by itself.
  await page.goto(`/search?q=${encodeURIComponent(`@${username}`)}`);
  await expect(page.getByRole("navigation", { name: "Search results" }).getByRole("link", { name: "People" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("list", { name: "People" }).getByRole("listitem").first()).toContainText(`@${username}`);

  // Following from a result is the same toggle as on a profile.
  await page.getByRole("button", { name: "Follow Zephyrine Quillfeather" }).click();
  await expect(page.getByRole("button", { name: "Following Zephyrine Quillfeather. Tap to unfollow" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Following Zephyrine Quillfeather. Tap to unfollow" })).toBeVisible();

  // No Follow button on my own row.
  await page.goto(`/search?tab=people&q=${E2E.admin.username}`);
  await expect(page.getByRole("list", { name: "People" })).toContainText(adminName);
  await expect(page.getByRole("button", { name: new RegExp(adminName) })).toHaveCount(0);

  // Nobody by that name.
  await page.goto("/search?tab=people&q=qqqqnoonehere");
  await expect(page.getByText(/No one found/)).toBeVisible();
});

test("a signed-out visitor is sent to sign in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/search?q=anything");
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});
