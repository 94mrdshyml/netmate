import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sendPost, signUpMember } from "./helpers";

// Home (docs/PRD.md section 8.3): "Mates of your mates", the "N new posts" pill and load on scroll. Every member here is new, so
// nothing is shared with other files, and nothing about the owner's settings changes.

type Who = { page: Page; context: { close: () => Promise<void> }; username: string };
let a: Who;
let b: Who;
let c: Who;

const follow = async (page: Page, username: string) => {
  await page.goto(`/${username}`);
  await page.getByRole("button", { name: /^Follow / }).first().click();
  // The label changes at once and the button is disabled until the server has saved it: wait for that.
  const following = page.getByRole("button", { name: /^Following / }).first();
  await expect(following).toBeVisible();
  await expect(following).toBeEnabled();
};

test.beforeAll(async ({ browser }) => {
  a = await signUpMember(browser, "198.18.64.1", { first: "Ann", last: "Reader" });
  b = await signUpMember(browser, "198.18.64.2", { first: "Ben", last: "Poster" });
  c = await signUpMember(browser, "198.18.64.3", { first: "Cat", last: "Mate" });
  await follow(a.page, b.username); // Ann follows Ben
  await follow(b.page, c.username); // Ben follows Cat, so Cat is a mate of Ann's mate
});

test.afterAll(async () => {
  await Promise.all([a.context.close(), b.context.close(), c.context.close()]);
});

test("people followed by people you follow are suggested in a block on Home, with a Follow button", async () => {
  await a.page.goto("/");
  const block = a.page.getByRole("region", { name: "Mates of your mates" });
  await expect(block).toBeVisible();
  await expect(block.getByRole("heading", { name: "Mates of your mates" })).toBeVisible();
  const row = block.getByRole("listitem").filter({ hasText: "Cat Mate" });
  await expect(row).toBeVisible();
  // Not yourself and not someone you already follow.
  await expect(block.getByText("Ben Poster")).toHaveCount(0);
  await expect(block.getByText("Ann Reader")).toHaveCount(0);
  const button = row.getByRole("button", { name: /^Follow / });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
  await button.click();
  // Following her shows "Following"; once the server has saved it the block is drawn again without her.
  await expect(row).toHaveCount(0);

  // Following Cat takes her off the next list.
  await a.page.reload();
  await expect(a.page.getByRole("region", { name: "Mates of your mates" }).getByText("Cat Mate")).toHaveCount(0);
});

test("a pill says how many new posts people you follow made, and pressing it shows them at the top", async () => {
  // The page checks every 30 seconds; the test moves the clock instead of waiting.
  await a.page.clock.install();
  await a.page.goto("/");
  await expect(a.page.getByRole("button", { name: /new post/ })).toHaveCount(0);

  await b.page.goto("/compose");
  const words = `fresh from ben ${Date.now().toString(36)}`;
  await b.page.getByLabel("Your post").fill(words);
  await sendPost(b.page);

  await a.page.clock.fastForward(31_000);
  const pill = a.page.getByRole("button", { name: "1 new post" });
  await expect(pill).toBeVisible();
  expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  await pill.click();
  await expect(a.page.getByRole("article").filter({ hasText: words })).toBeVisible();
  await expect(a.page.getByRole("button", { name: /new post/ })).toHaveCount(0);
});

test("posts load as you scroll, each only once", async ({ browser }) => {
  test.setTimeout(150_000);
  const l = await signUpMember(browser, "198.18.64.4", { first: "Lou", last: "Lister" });
  try {
    // Lou follows Ben, who follows Cat, so the Mates block has Cat in it.
    await follow(l.page, b.username);
    const host = new URL(l.page.url()).hostname;
    // Posting is limited to 10 a minute, so each batch of nine counts against its own allowance (the same thing every test does for itself).
    for (let i = 0; i < 21; i++) {
      if (i % 9 === 0) await l.context.addCookies([{ name: "e2e_scope", value: `feed-extras-${Date.now()}-${i}`, domain: host, path: "/" }]);
      await l.page.goto("/compose");
      await l.page.getByLabel("Your post").fill(`list post ${i} ${Date.now().toString(36)}`);
      await sendPost(l.page);
    }

    await l.page.goto("/");
    const articles = l.page.getByRole("article");
    await expect(articles).toHaveCount(20);
    await expect(l.page.getByRole("button", { name: "More posts" })).toBeVisible();

    // Coming near the end loads the next page without pressing anything.
    await l.page.locator(".feed-end").scrollIntoViewIfNeeded();
    await expect.poll(() => articles.count()).toBeGreaterThan(20);

    const loaded = await articles.count();
    const ids = await articles.evaluateAll((all) => all.map((el) => (el as HTMLElement).dataset.postId));
    expect(new Set(ids).size).toBe(ids.length);

    // Deleting a post that came in on the second page takes it off the list at once. Lou's own posts come first, newest first, so
    // the oldest of them ("list post 0") is the twenty-first and is on the second page.
    const last = articles.filter({ hasText: "list post 0 " });
    await expect(last).toHaveCount(1);
    await last.getByRole("button", { name: "More options" }).click();
    await last.getByRole("button", { name: "Delete post" }).click();
    await last.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(articles).toHaveCount(loaded - 1);

    // A button that changes something redraws the page in the background. What has loaded must stay.
    const row = l.page.getByRole("region", { name: "Mates of your mates" }).getByRole("listitem").filter({ hasText: "Cat Mate" });
    await row.getByRole("button", { name: /^Follow / }).click();
    await expect(row).toHaveCount(0);
    await expect(articles).toHaveCount(loaded - 1);
  } finally {
    await l.context.close();
  }
});
