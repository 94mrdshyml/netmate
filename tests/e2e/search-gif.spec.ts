import { expect, test, type Page } from "@playwright/test";
import { sendPost } from "./helpers";

// Named so it runs after posts.spec (which sends exactly 10 admin posts a minute in a burst). Serial: each test uses the state the one before left. Klipy is never reached: every request to its
// API and its picture hosts is answered here. Only two admin posts are made and no member is signed up
// (the sign-up budget is used up, see session 33).
test.describe.configure({ mode: "serial" });

const KEY = "e2e_klipy_key_12345678";
const unique = () => `gif ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const card = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

// A one-pixel GIF stands in for every picture.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const item = (id: number, title: string) => ({
  id,
  slug: `gif-${id}`,
  title,
  file: {
    md: { webp: { url: `https://static.klipy.com/md/${id}.webp`, width: 320, height: 240, size: 100 } },
    sm: { webp: { url: `https://static1.klipy.com/sm/${id}.webp`, width: 160, height: 120, size: 50 } },
  },
});

const answers: Record<string, ReturnType<typeof item>[]> = {
  trending: [item(1, "Trending dance"), item(2, "Trending wave")],
  cat: [item(3, "Cat nap"), item(4, "Cat jump")],
};

/** Answers Klipy's API (right key only) and its picture hosts, and notes every API request. */
async function stubKlipy(page: Page) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  await page.route("https://api.klipy.com/**", async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), headers: await request.allHeaders() });
    const url = new URL(request.url());
    const cors = { "access-control-allow-origin": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": "*" } });
    if (!url.pathname.startsWith(`/api/v1/${KEY}/`)) {
      return route.fulfill({ status: 404, headers: cors, contentType: "application/json", body: JSON.stringify({ result: false, errors: { message: ["The provided API key is invalid."] } }) });
    }
    const q = url.searchParams.get("q") ?? "";
    const list = url.pathname.endsWith("/trending") ? answers.trending : (answers[q] ?? []);
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ result: true, data: { data: list, current_page: 1, per_page: 24, has_next: false } }),
    });
  });
  await page.route(/https:\/\/static[12]?\.klipy\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL, headers: { "access-control-allow-origin": "*" } }));
  return seen;
}

test("with no key saved (the default) there is no GIF button and a GIF cannot be posted", async ({ page }) => {
  await page.goto("/compose");
  await expect(page.getByLabel("Your post")).toBeVisible();
  await expect(page.getByRole("button", { name: /GIF/ })).toHaveCount(0);
  // Nothing about the key is in the page.
  expect(await page.content()).not.toContain("klipy");
});

test("the admin saves a Klipy key from Services: a wrong one is refused, a right one turns GIF search on", async ({ page }) => {
  await stubKlipy(page);
  await page.goto("/hq/services");
  const field = page.getByLabel("Klipy API key");
  await expect(field).toHaveAttribute("type", "password");
  await expect(page.getByText("Klipy puts the key in every search address")).toBeVisible();

  await field.fill("short");
  await page.getByRole("button", { name: "Save and turn on" }).click();
  await expect(page.getByText("That does not look like a Klipy key.")).toBeVisible();

  await field.fill("wrong_key_12345678");
  await page.getByRole("button", { name: "Save and turn on" }).click();
  await expect(page.getByText("Klipy did not accept that key.")).toBeVisible();

  await field.fill(KEY);
  await page.getByRole("button", { name: "Save and turn on" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. GIF search is on." })).toBeVisible();
  await expect(page.getByLabel("Klipy API key")).toHaveValue("");

  // After a reload it says "On", the key is not shown, and it can be replaced or removed.
  await page.reload();
  await expect(page.getByLabel("Klipy API key")).toHaveAttribute("placeholder", "Key saved");
  expect(await page.content()).not.toContain(KEY);
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove key and turn off" })).toBeVisible();
});

test("the GIF button opens a search that asks Klipy straight from the phone, and a chosen GIF goes on the post", async ({ page }) => {
  const seen = await stubKlipy(page);
  await page.goto("/compose");
  const button = page.getByRole("button", { name: "Add a GIF" });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();

  // Klipy's rules require this exact wording, and the box is focused.
  const search = page.getByPlaceholder("Search KLIPY");
  await expect(search).toBeFocused();
  await expect(page.getByText("Powered by KLIPY")).toBeVisible();

  // It opens on what is trending, in Klipy's order.
  const choices = page.getByRole("list", { name: "GIFs" }).getByRole("button");
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveAccessibleName("Use GIF: Trending dance");
  await expect(choices.nth(1)).toHaveAccessibleName("Use GIF: Trending wave");

  await search.fill("cat");
  await expect(choices.nth(0)).toHaveAccessibleName("Use GIF: Cat nap");
  await expect(choices.nth(1)).toHaveAccessibleName("Use GIF: Cat jump");
  for (const choice of await choices.all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Enter does not post the form, and words with no result say so.
  await search.press("Enter");
  await expect(page).toHaveURL(/\/compose$/);
  await search.fill("zzzz");
  await expect(page.getByText("No GIFs found. Try other words.")).toBeVisible();
  await search.fill("cat");
  await expect(choices).toHaveCount(2);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // Klipy was asked with the key in the address, and was given no cookie and no referrer.
  const asked = seen.filter((r) => r.url.includes(`/api/v1/${KEY}/gifs/`));
  expect(asked.some((r) => r.url.includes("/gifs/trending"))).toBe(true);
  expect(asked.some((r) => r.url.includes("/gifs/search") && r.url.includes("q=cat"))).toBe(true);
  for (const r of asked) {
    expect(r.headers.cookie).toBeUndefined();
    expect(r.headers.referer).toBeUndefined();
    expect(r.url).not.toContain("customer_id");
  }

  await choices.nth(0).click();
  await expect(page.getByPlaceholder("Search KLIPY")).toHaveCount(0);
  const chosen = page.locator(".composer-gif img");
  await expect(chosen).toHaveAttribute("alt", "Cat nap");
  await expect(chosen).toHaveAttribute("src", "https://static.klipy.com/md/3.webp");
  // A GIF and pictures do not go together.
  await expect(page.getByRole("button", { name: "Add pictures (not with a GIF)" })).toBeDisabled();

  // Taking it off frees the picture button again; choosing again brings it back.
  await page.getByRole("button", { name: "Remove GIF" }).click();
  await expect(page.locator(".composer-gif")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add pictures" })).toBeEnabled();
  await page.getByRole("button", { name: "Add a GIF" }).click();
  await page.getByRole("button", { name: "Use GIF: Trending wave" }).click();
  await expect(page.locator(".composer-gif img")).toHaveAttribute("alt", "Trending wave");

  const text = unique();
  await page.getByLabel("Your post").fill(text);
  await sendPost(page);
  const gif = card(page, text).locator(".post-gif img");
  await expect(gif).toHaveAttribute("src", "https://static.klipy.com/md/2.webp");
  await expect(gif).toHaveAttribute("alt", "Trending wave");
  await expect(gif).toHaveAttribute("referrerpolicy", "no-referrer");

  // On the post's own page, and after a reload, still there. The reply box offers a GIF too.
  await card(page, text).getByRole("link", { name: /^Reply/ }).click();
  await expect(page).toHaveURL(/\/status\/post_/);
  await expect(card(page, text).locator(".post-gif img")).toHaveAttribute("alt", "Trending wave");
  await expect(page.getByRole("button", { name: "Add a GIF" })).toBeVisible();
  await page.reload();
  await expect(card(page, text).locator(".post-gif img")).toHaveAttribute("alt", "Trending wave");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a GIF can be a whole post with no words, and Escape closes the search", async ({ page }) => {
  await stubKlipy(page);
  await page.goto("/compose");
  // Nothing to post yet.
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Add a GIF" }).click();
  await page.getByPlaceholder("Search KLIPY").press("Escape");
  await expect(page.getByPlaceholder("Search KLIPY")).toHaveCount(0);

  await page.getByRole("button", { name: "Add a GIF" }).click();
  await page.getByRole("button", { name: "Use GIF: Trending dance" }).click();
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  await sendPost(page);
  await expect(page.locator(".post-gif img[alt='Trending dance']").first()).toBeVisible();
});

test("when Klipy cannot be reached the member is told, and the post box still works", async ({ page }) => {
  await page.route("https://api.klipy.com/**", (route) => route.abort());
  await page.goto("/compose");
  await page.getByRole("button", { name: "Add a GIF" }).click();
  await expect(page.getByText("Could not reach the GIF service. Check your connection.")).toBeVisible();
  await page.getByRole("button", { name: "Close GIF search" }).click();
  await page.getByLabel("Your post").fill("still fine");
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
});

test("removing the key turns GIF search off, hides the button, and GIFs already posted still show", async ({ page }) => {
  await stubKlipy(page);
  await page.goto("/hq/services");
  await page.getByRole("button", { name: "Remove key and turn off" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByRole("button", { name: "Save and turn on" })).toBeVisible();

  await page.goto("/compose");
  await expect(page.getByLabel("Your post")).toBeVisible();
  await expect(page.getByRole("button", { name: /GIF/ })).toHaveCount(0);

  await page.goto("/");
  await expect(page.locator(".post-gif img").first()).toBeVisible();
});
