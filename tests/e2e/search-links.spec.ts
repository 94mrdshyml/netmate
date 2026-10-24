import { expect, test, type Page } from "@playwright/test";
import { sendPost } from "./helpers";
import { solidPng } from "./png";

// Serial: each test uses the state the one before left. Named so it runs after posts.spec (which sends
// exactly 10 admin posts a minute in a burst). Two admin posts and no sign-ups (the sign-up budget is used
// up, see session 33). The server runs with ENV=test, so it answers with a made-up web: news.example.test
// has a card with a picture, plain.example.test one without, and every other site cannot be reached.
test.describe.configure({ mode: "serial" });

const unique = () => `link ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const card = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });
const box = (page: Page) => page.getByLabel("Your post");
const NEWS = "https://news.example.test/story";

/** The card's picture lives on a made-up host, so the browser is handed a small picture for it. */
async function stubPicture(page: Page) {
  const asked: string[] = [];
  await page.route("https://images.example.test/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: solidPng(1200, 630, [30, 110, 79]) });
  });
  return asked;
}

test("with link previews off (the default) pasting a link shows nothing and the route says not found", async ({ page }) => {
  await page.goto("/compose");
  await box(page).fill(`look ${NEWS}`);
  await page.waitForTimeout(1200);
  await expect(page.locator(".link-card")).toHaveCount(0);
  await expect(page.getByText("Getting a preview of the link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  const res = await page.request.post("/api/link-preview", { data: { url: NEWS } });
  expect(res.status()).toBe(404);
});

test("the admin turns link previews on from Services, and it stays on", async ({ page }) => {
  await page.goto("/hq/services");
  await expect(page.getByText("the card's picture is loaded by each reader's own phone")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Show link previews" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("status").filter({ hasText: "Link previews are on." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Show link previews" })).toHaveAttribute("aria-checked", "true");
});

test("pasting a link shows a card within a few seconds, before posting, and the card can be removed", async ({ page }) => {
  await stubPicture(page);
  await page.goto("/compose");
  const started = Date.now();
  await box(page).fill(`look at this ${NEWS} it is good`);

  // First "getting a preview", with the Post button waiting; then the card.
  await expect(page.getByText("Getting a preview of the link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  const preview = page.getByRole("group", { name: "Preview of Example News" });
  await expect(preview).toBeVisible();
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(preview).toContainText("A made-up headline for the tests");
  await expect(preview).toContainText("This page does not exist.");
  await expect(preview.locator("img")).toHaveAttribute("src", "https://images.example.test/card.png");
  await expect(preview.locator("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // The x takes the card away and it does not come back for the same address.
  const remove = page.getByRole("button", { name: "Remove link preview" });
  expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(preview).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(preview).toHaveCount(0);

  // A different address gets its own card.
  await box(page).fill("another https://plain.example.test/page");
  await expect(page.getByRole("group", { name: "Preview of plain.example.test" })).toContainText("A page with no picture");
  await expect(page.getByRole("group", { name: "Preview of plain.example.test" }).locator("img")).toHaveCount(0);
});

test("a link that cannot be read, or is not a web address, gets no card and does not hold up the post", async ({ page }) => {
  await page.goto("/compose");
  for (const text of ["gone https://nothing.example.test/x", "local http://127.0.0.1/admin", "mail me@example.com", "ftp ftp://news.example.test/a"]) {
    await box(page).fill(text);
    await page.waitForTimeout(1300);
    await expect(page.locator(".link-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  }
});

test("a post keeps its card, and its web address is a link", async ({ page }) => {
  await stubPicture(page);
  const words = unique();
  await page.goto("/compose");
  await box(page).fill(`${words} ${NEWS}`);
  await expect(page.getByRole("group", { name: "Preview of Example News" })).toBeVisible();
  await sendPost(page);

  const mine = card(page, words).first();
  // The card: picture, site, title, description, and the whole thing opens the page in a new tab.
  const link = mine.getByRole("link", { name: /^A made-up headline for the tests, from Example News$/ });
  await expect(link).toHaveAttribute("href", NEWS);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /nofollow/);
  await expect(link.locator("img")).toHaveAttribute("src", "https://images.example.test/card.png");
  await expect(link).toContainText("Example News");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The address in the words is a link too, shown exactly as typed.
  const inText = mine.locator(".post-body").getByRole("link", { name: NEWS });
  await expect(inText).toHaveAttribute("href", NEWS);
  await expect(mine.locator(".post-body")).toHaveText(`${words} ${NEWS}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // After a reload, and on the post's own page, it is still there.
  await page.reload();
  await expect(card(page, words).first().locator(".link-card")).toHaveCount(1);
  await card(page, words).first().getByRole("link", { name: /^Reply/ }).click();
  await expect(page).toHaveURL(/\/status\/post_/);
  await expect(card(page, words).first().locator(".link-card")).toHaveCount(1);
});

test("a removed card is not saved, adding a picture drops the card, and the web address still links", async ({ page }) => {
  await stubPicture(page);
  const words = unique();
  await page.goto("/compose");
  await box(page).fill(`${words} ${NEWS}`);
  await expect(page.getByRole("group", { name: "Preview of Example News" })).toBeVisible();
  await page.getByRole("button", { name: "Remove link preview" }).click();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const mine = card(page, words).first();
  await expect(mine.locator(".link-card")).toHaveCount(0);
  await expect(mine.locator(".post-body").getByRole("link", { name: NEWS })).toHaveAttribute("href", NEWS);

  // With a picture attached there is no card (a post has a card or pictures).
  await page.goto("/compose");
  await box(page).fill(`${unique()} ${NEWS}`);
  await expect(page.getByRole("group", { name: "Preview of Example News" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "a.png", mimeType: "image/png", buffer: solidPng(48, 32) });
  await expect(page.getByRole("img", { name: "Picture 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Preview of Example News" })).toHaveCount(0);
});

test("the preview route needs a signed-in member on this site, and says nothing of what it cannot read", async ({ page, browser }) => {
  const ok = await page.request.post("/api/link-preview", { data: { url: NEWS } });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { card: { url: string; title: string }; token: string };
  expect(body.card).toMatchObject({ url: NEWS, title: "A made-up headline for the tests" });
  // The token is signed: it is "payload.signature" and says nothing the card does not.
  expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(ok.headers()["cache-control"]).toContain("no-store");

  for (const data of [{ url: "https://nothing.example.test/x" }, { url: "http://127.0.0.1/" }, { url: "ftp://news.example.test/" }, { url: 5 }, {}, { url: "x".repeat(600) }]) {
    const res = await page.request.post("/api/link-preview", { data });
    expect(res.status(), JSON.stringify(data)).toBe(200);
    expect(await res.json()).toEqual({ card: null });
  }
  expect((await page.request.post("/api/link-preview", { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(200);

  // Another site cannot spend the member's fetches.
  const cross = await page.request.post("/api/link-preview", { data: { url: NEWS }, headers: { origin: "https://evil.example.org" } });
  expect(cross.status()).toBe(403);

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await context.request.post("/api/link-preview", { data: { url: NEWS } })).status()).toBe(401);
  await context.close();
});

test("a card made up by a browser is not saved: only the signed one is", async ({ page }) => {
  await stubPicture(page);
  const words = unique();
  await page.goto("/compose");
  // The page asks for the card, but the answer is changed on its way, as a hostile browser could.
  await page.route("**/api/link-preview", async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { card: { title: string }; token: string };
    await route.fulfill({ response: real, json: { card: { ...body.card, title: "Forged" }, token: `${body.token.slice(0, -2)}xx` } });
  });
  await box(page).fill(`${words} ${NEWS}`);
  await expect(page.getByRole("group", { name: "Preview of Example News" })).toContainText("Forged");
  await sendPost(page);
  // The post is made, but without a card, because the token did not check out.
  const mine = card(page, words).first();
  await expect(mine).toBeVisible();
  await expect(mine.locator(".link-card")).toHaveCount(0);
});

test("turning link previews off hides the preview again", async ({ page }) => {
  await page.goto("/hq/services");
  await page.getByRole("switch", { name: "Show link previews" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link previews are off." })).toBeVisible();
  await page.goto("/compose");
  await box(page).fill(`look ${NEWS}`);
  await page.waitForTimeout(1200);
  await expect(page.locator(".link-card")).toHaveCount(0);
  // Cards already on posts stay.
  await page.goto("/");
  await expect(page.locator(".link-card").first()).toBeVisible();
});
