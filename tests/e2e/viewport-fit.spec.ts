import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sendPost } from "./helpers";

// Nothing may be wider than the phone. On a real phone, one wide element makes the browser widen the page's
// own measuring stick (window.innerWidth and documentElement.clientWidth grow with it), so the bottom bar and
// the compose button are laid out for a wider screen and end up cut off at the edge. That is why this test
// measures against the width the phone really has (the viewport we set), never against innerWidth.
// Named to run after the other specs: it makes one admin post and takes its repost back at the end.

const unique = () => `fit ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const WIDTHS = [360, 390, 412];

async function wideThings(page: Page, width: number) {
  return page.evaluate((w) => {
    const wide: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && (box.right > w + 0.5 || box.left < -0.5)) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${Math.round(box.left)}..${Math.round(box.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, wide: wide.slice(0, 6) };
  }, width);
}

test("a repost line and a long web address never make the page wider than the phone", async ({ page }) => {
  const stamp = unique();
  const text = `${stamp} https://example.com/${"a".repeat(80)}`;
  await page.goto("/compose");
  await page.getByLabel("Your post").fill(text);
  await sendPost(page);

  const mine = () => page.getByRole("article").filter({ hasText: stamp }).first();
  await mine().getByRole("button", { name: /^Repost, 0 times/ }).click();
  await page.getByRole("menu", { name: "Repost" }).getByRole("menuitem", { name: "Repost" }).click();
  // The button changes at once and the server finishes a moment later, so look again until the line is there.
  const reposted = page.locator("article").filter({ has: page.getByText("You reposted") }).filter({ hasText: stamp });
  await expect(async () => {
    await page.goto("/?feed=following");
    await expect(reposted).toHaveCount(1, { timeout: 2000 });
  }).toPass();

  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/?feed=following", "/search", "/notifications", "/settings"]) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        const seen = await wideThings(page, width);
        expect(seen, `${path} at ${width}px`).toEqual({ scrollWidth: width, wide: [] });
      }

      // The bottom bar and the compose button sit fully inside the screen, and the bar spans it.
      await page.goto("/?feed=following");
      const nav = (await page.locator(".bottom-nav").boundingBox())!;
      expect(nav.x, `bottom bar left at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(nav.x + nav.width, `bottom bar right at ${width}px`).toBeLessThanOrEqual(width);
      expect(nav.y + nav.height, `bottom bar bottom at ${width}px`).toBeLessThanOrEqual(800);
      const fab = (await page.locator(".fab").boundingBox())!;
      expect(fab.x + fab.width, `compose button right at ${width}px`).toBeLessThanOrEqual(width - 8);

      // The post's own page too.
      await page.goto("/?feed=following");
      await mine().getByRole("link", { name: /^Reply/ }).click();
      await expect(page).toHaveURL(/\/status\/post_/);
      expect(await wideThings(page, width), `post page at ${width}px`).toEqual({ scrollWidth: width, wide: [] });
    }
  } finally {
    // Take the repost back so later specs see the feed they expect.
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/?feed=following");
    await reposted.getByRole("button", { name: /^Repost, 1 time/ }).click();
    await page.getByRole("menu", { name: "Repost" }).getByRole("menuitem", { name: "Undo repost" }).click();
    await expect(reposted.getByRole("button", { name: /^Repost, 0 times/ })).toBeVisible();
  }
});
