import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./constants";

const accountLink = (page: Page) => page.getByRole("link", { name: `Settings, signed in as @${E2E.admin.username}` });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("my picture opens Settings from Home, Search and Alerts", async ({ page }) => {
  for (const path of ["/", "/search", "/notifications"]) {
    await page.goto(path);
    await expect(accountLink(page)).toHaveAttribute("href", "/settings");
    const box = (await accountLink(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.goto("/");
  await accountLink(page).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("Settings is a plain list: edit profile, invites, admin panel, theme and log out, each with a short line under it", async ({ page }) => {
  await page.goto("/settings");
  const list = page.getByRole("list", { name: "Settings" });

  await expect(list.getByRole("link", { name: /^Edit profile/ })).toHaveAttribute("href", "/profile");
  await expect(list.getByRole("link", { name: /^Edit profile/ })).toContainText("Name, bio and photos");
  await expect(list.getByRole("link", { name: /^Invite people/ })).toHaveAttribute("href", "/invite");
  await expect(list.getByRole("link", { name: /^Admin panel/ })).toHaveAttribute("href", "/hq");
  await expect(list).toContainText("Dark or light theme");
  await expect(list.getByRole("button", { name: "Switch between light and dark" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // Every row is easy to hit, the title is centred, and nothing scrolls sideways.
  for (const control of [...(await list.getByRole("link").all()), list.getByRole("button"), page.getByRole("button", { name: "Log out" })]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const title = (await page.getByRole("heading", { name: "Settings" }).boundingBox())!;
  const mid = title.x + title.width / 2;
  expect(Math.abs(mid - page.viewportSize()!.width / 2)).toBeLessThan(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // Settings is no longer a tab, so it has a way back.
  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("your own profile has one way in, the Profile tab, and not a second one in Settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Profile" })).toHaveCount(1);
  await expect(nav(page).getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/${E2E.admin.username}`);

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Profile/ })).toHaveCount(1); // the tab again
  await expect(page.getByRole("list", { name: "Settings" }).getByRole("link", { name: /^Profile/ })).toHaveCount(0);
});

test("hovering or pressing an icon turns it the brand colour, with no background behind it", async ({ page }) => {
  await page.goto("/");
  // The current tab already wears the brand colour, so that is the colour to expect.
  const brandText = await nav(page).locator('a[aria-current="page"]').evaluate((el) => getComputedStyle(el).color);

  // The others are quiet until the pointer is on them.
  const search = nav(page).getByRole("link", { name: "Search" });
  const before = await search.evaluate((el) => getComputedStyle(el).color);
  expect(before).not.toBe(brandText);
  await search.hover();
  await expect.poll(() => search.evaluate((el) => getComputedStyle(el).color)).toBe(brandText);
  expect(await search.locator(".nav-icon").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  // Round icon buttons do the same.
  const theme = page.getByRole("button", { name: "Switch between light and dark" });
  await theme.hover();
  await expect.poll(() => theme.evaluate((el) => getComputedStyle(el).color)).toBe(brandText);
  expect(await theme.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});

test("text is a notch smaller and only names and titles are heavy", async ({ page }) => {
  await page.goto("/settings");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("15px");
  const weight = (selector: string) => page.locator(selector).first().evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(await weight("h1")).toBeLessThanOrEqual(600);
  expect(await weight(".srow-title")).toBeLessThanOrEqual(500);
  expect(await weight(".bottom-nav a")).toBeLessThanOrEqual(500);
  expect(await weight('.bottom-nav a[aria-current="page"], .bottom-nav a')).toBeLessThanOrEqual(500);
  expect(await weight(".btn")).toBeLessThanOrEqual(500);
});

test("Edit profile has a close button, Save in the header, counters on every field and camera buttons on the pictures", async ({ page }) => {
  await page.goto("/profile");
  const header = page.locator("header.edit-header");
  await expect(header.getByRole("heading", { name: "Edit profile" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(header.getByRole("link", { name: /^Close/ })).toHaveAttribute("href", `/${E2E.admin.username}`);

  // The pictures can be changed from the cover and from the picture itself.
  await expect(page.getByLabel("Cover picture")).toBeAttached();
  await expect(page.getByLabel("Profile picture")).toBeAttached();
  for (const label of ["Change cover picture", "Change profile picture"]) {
    const box = (await page.locator(`label[title="${label}"]`).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // Each field shows how many characters it has used.
  const bio = page.getByLabel("Bio");
  await bio.fill("Hello there");
  await expect(page.locator(".tfield").filter({ has: bio })).toContainText("11 / 160");
  await bio.fill("x".repeat(165));
  await expect(page.locator(".tfield").filter({ has: bio }).locator(".tfield-count")).toHaveClass(/over/);
  await expect(page.locator(".tfield").filter({ has: page.getByLabel("First name") })).toContainText(`/ 50`);

  // The username is shown but cannot be changed.
  await expect(page.getByLabel("Username")).toHaveAttribute("readonly", "");

  // The page fits the phone, and the header sticks while the page scrolls.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(header.getByRole("button", { name: "Save" })).toBeInViewport();

  // Close goes back to my profile without saving.
  await header.getByRole("link", { name: /^Close/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${E2E.admin.username}$`));
});

test("on a wide screen a hairline marks each edge of the phone column, on a phone and in the admin panel there is none", async ({ page }) => {
  const frame = () =>
    page.evaluate(() => {
      const edge = getComputedStyle(document.body, "::before");
      const column = document.querySelector("main.column")?.getBoundingClientRect();
      return {
        content: edge.content,
        width: edge.width,
        left: edge.borderLeftWidth,
        right: edge.borderRightWidth,
        marginLeft: parseFloat(edge.marginLeft),
        columnLeft: column?.left ?? -1,
      };
    });

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/");
  const wide = await frame();
  expect(wide.content).not.toBe("none");
  expect(wide.width).toBe("480px");
  expect(wide.left).toBe("1px");
  expect(wide.right).toBe("1px");
  // The lines sit exactly on the column's edges.
  expect(Math.abs(wide.marginLeft - wide.columnLeft)).toBeLessThan(1);
  // And they do not scroll the page sideways or catch clicks.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // The same on a screen as wide as the column or narrower: nothing is drawn.
  await page.setViewportSize({ width: 412, height: 800 });
  expect((await frame()).content).toBe("none");

  // The admin panel is the one wide layout and has no phone column to frame.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/hq");
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").content)).toBe("none");
});
