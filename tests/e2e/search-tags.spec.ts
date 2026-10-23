import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";
import { sendPost } from "./helpers";

// Serial: each test uses the state the one before left. Named so it runs after posts.spec (which sends
// exactly 10 admin posts a minute in a burst). One admin post and no sign-ups (the sign-up budget is used
// up, see session 33): the admin mentions their own name, and someone who does not exist.
test.describe.configure({ mode: "serial" });

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const WORD = `morning${stamp}`;
const TAG = `coffee${stamp}`;
const TEXT = `${WORD} #${TAG} with @${E2E.admin.username} and @nobodyhere, again #${TAG.toUpperCase()}`;
const card = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

test("a post's #tags and @names become links, but only real people", async ({ page }) => {
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(TEXT);
  await sendPost(page);

  const mine = card(page, WORD).first();
  const body = mine.locator(".post-body");
  // Both spellings of the tag link to the same lower-case search.
  const tags = body.getByRole("link", { name: new RegExp(`^#${TAG}$`, "i") });
  await expect(tags).toHaveCount(2);
  for (const link of await tags.all()) expect(await link.getAttribute("href")).toBe(`/search?q=${encodeURIComponent(`#${TAG}`)}`);
  // The words are still exactly what was typed.
  await expect(body).toHaveText(TEXT);

  // A name that exists is a link to the person; one that does not is plain text.
  await expect(body.getByRole("link", { name: `@${E2E.admin.username}` })).toHaveAttribute("href", `/${E2E.admin.username}`);
  await expect(body.getByRole("link", { name: "@nobodyhere" })).toHaveCount(0);
  await expect(body).toContainText("@nobodyhere");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("tapping a tag searches that exact tag, and only the tag", async ({ page }) => {
  await page.goto("/");
  await card(page, WORD).first().locator(".post-body").getByRole("link", { name: `#${TAG}` }).first().click();
  await expect(page).toHaveURL(new RegExp(`/search\\?q=%23${TAG}$`));
  await expect(page.getByRole("searchbox")).toHaveValue(`#${TAG}`);
  // The Posts tab lists the post that has the tag.
  await expect(card(page, WORD)).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Search results" }).getByRole("link", { name: "Posts" })).toHaveAttribute("aria-current", "page");

  // Part of a tag is not the tag, and the plain word without a hash is a text search, not a tag.
  await page.goto(`/search?q=${encodeURIComponent(`#${TAG.slice(0, -2)}`)}`);
  await expect(page.getByText("No posts found for")).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(`#${WORD}`)}`);
  await expect(page.getByText("No posts found for")).toBeVisible();
  // The same words as text still find the post.
  await page.goto(`/search?q=${encodeURIComponent(WORD)}`);
  await expect(card(page, WORD)).toHaveCount(1);
});

test("tapping a name opens that person's page", async ({ page }) => {
  await page.goto("/");
  await card(page, WORD).first().locator(".post-body").getByRole("link", { name: `@${E2E.admin.username}` }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}$`));
  await expect(page.getByRole("heading", { name: `${E2E.admin.firstName} ${E2E.admin.lastName}` })).toBeVisible();
  await expect(card(page, WORD)).toHaveCount(1);
});
