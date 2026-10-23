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

test("on a wide screen the page around the phone column is a shade apart and a hairline marks each edge; a phone and the admin panel have none", async ({ page }) => {
  const frame = () =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const box = document.body.getBoundingClientRect();
      const column = document.querySelector("main.column")?.getBoundingClientRect();
      const nav = document.querySelector(".bottom-nav");
      return {
        maxWidth: body.maxWidth,
        left: body.borderLeftWidth,
        right: body.borderRightWidth,
        around: getComputedStyle(document.documentElement).backgroundColor,
        inside: body.backgroundColor,
        bodyWidth: box.width,
        bodyLeft: box.left,
        columnLeft: column?.left ?? -1,
        navEdge: nav ? getComputedStyle(nav).borderLeftWidth : "none",
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/");
  const wide = await frame();
  expect(wide.left).toBe("1px");
  expect(wide.right).toBe("1px");
  expect(wide.bodyWidth).toBe(480);
  expect(wide.around).not.toBe(wide.inside);
  // The lines are the body's own edges, so they sit exactly on the column, and the bottom bar has them too.
  expect(Math.abs(wide.columnLeft - (wide.bodyLeft + 1))).toBeLessThan(1);
  expect(wide.navEdge).toBe("1px");
  expect(wide.overflow).toBeLessThanOrEqual(0);

  // A screen as wide as the column or narrower: nothing around it, nothing drawn.
  await page.setViewportSize({ width: 412, height: 800 });
  const phone = await frame();
  expect(phone.left).toBe("0px");
  expect(phone.around).toBe(phone.inside);

  // The admin panel is the one wide layout and has no phone column to frame.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/hq");
  const hq = await page.evaluate(() => ({ left: getComputedStyle(document.body).borderLeftWidth, maxWidth: getComputedStyle(document.body).maxWidth }));
  expect(hq).toEqual({ left: "0px", maxWidth: "none" });
});

test("every icon has the same line thickness", async ({ page }) => {
  for (const path of ["/settings", "/", "/search"]) {
    await page.goto(path);
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("svg[focusable='false']")].map((svg) => svg.getAttribute("stroke-width")),
    );
    expect(widths.length, path).toBeGreaterThan(4);
    expect(new Set(widths), path).toEqual(new Set(["1.75"]));
  }
});

test("empty lists show an icon, a plain line, a hint and, where it helps, a button", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("qqqqzzzznothinghere")}`);
  const posts = page.locator(".empty-state");
  await expect(posts.locator(".empty-icon")).toBeVisible();
  await expect(posts.getByText(/No posts found/)).toBeVisible();
  await expect(posts.getByText("Try another word.")).toBeVisible();

  await page.goto(`/search?tab=people&q=${encodeURIComponent("qqqqzzzznothinghere")}`);
  await expect(page.locator(".empty-state").getByText(/No one found/)).toBeVisible();

  // The title is plain text a person would say, and the whole thing fits the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the default cover is a clear wash of the brand colour in dark mode, not a black gap", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/${E2E.admin.username}`);
  const cover = page.locator(".banner-flat").first();
  await expect(cover).toBeVisible();
  const [r, g, b] = (await cover.evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g)!.map(Number);
  expect(Math.max(r!, g!, b!)).toBeGreaterThanOrEqual(25);
});

test("tapping a link starts a thin loading line along the top that finishes when the screen arrives", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const bar = document.querySelector(".nav-progress")!;
    const seen: string[] = [];
    (window as unknown as { __phases: string[] }).__phases = seen;
    new MutationObserver(() => seen.push(bar.getAttribute("data-phase") ?? "")).observe(bar, { attributes: true, attributeFilter: ["data-phase"] });
  });
  await expect(page.locator(".nav-progress")).toHaveAttribute("data-phase", "idle");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.locator(".nav-progress")).toHaveAttribute("data-phase", "idle");
  const phases = await page.evaluate(() => (window as unknown as { __phases: string[] }).__phases);
  expect(phases).toContain("loading");
  expect(phases).toContain("done");
  expect(phases.indexOf("loading")).toBeLessThan(phases.indexOf("done"));

  // It is a thin line, and invisible to the screen reader and to taps.
  const bar = page.locator(".nav-progress");
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(3);
});

test("moving to another screen fades it in and keeps the bottom bar still; typing on the same screen does not", async ({ page }) => {
  // Count how often the page asks the browser for a view transition.
  await page.addInitScript(() => {
    const w = window as unknown as { __moves: number; __played: string[] };
    w.__moves = 0;
    w.__played = [];
    const original = document.startViewTransition?.bind(document);
    if (original) {
      document.startViewTransition = ((arg: unknown) => {
        w.__moves += 1;
        const transition = original(arg as never);
        // Once the browser has set the move up, note which of our animations are running.
        void transition.ready.then(() => {
          w.__played.push(...document.getAnimations().map((a) => (a as CSSAnimation).animationName ?? ""));
        });
        return transition;
      }) as typeof document.startViewTransition;
    }
  });
  const moves = () => page.evaluate(() => (window as unknown as { __moves: number }).__moves);

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect.poll(moves).toBeGreaterThan(0);
  // The new screen really fades and rises (the names match the styles in globals.css).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played))
    .toEqual(expect.arrayContaining(["screen-fade", "screen-rise"]));

  // The bottom bar has a name of its own, so it is lifted out and does not fade with the screen.
  expect(await page.locator(".bottom-nav").evaluate((el) => getComputedStyle(el).viewTransitionName)).toBe("bottom-nav");

  // Typing in the box changes the address but stays on the same screen: no movement.
  const before = await moves();
  await page.getByRole("searchbox", { name: "Search posts and people" }).fill("zephyr");
  await expect(page).toHaveURL(/q=zephyr/);
  await page.waitForTimeout(400);
  expect(await moves()).toBe(before);
});

test("the admin panel has a side menu with icons, breadcrumbs and flat cards, and folds into a strip on a phone", async ({ page }) => {
  const pages = ["Overview", "Approvals", "Invites", "Branding", "Email"];
  const menu = page.getByRole("navigation", { name: "Admin" });
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/hq");
  // Every page is in the menu with an icon, easy to hit, and the current one is marked.
  for (const name of pages) {
    const link = menu.getByRole("link", { name: new RegExp(name) });
    await expect(link.locator("svg")).toHaveCount(1);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(menu.getByRole("link", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
  // On a wide screen the menu stands on the left, beside the page.
  const side = (await menu.boundingBox())!;
  const heading = (await page.getByRole("heading", { name: "Overview" }).boundingBox())!;
  expect(side.x).toBeLessThan(heading.x);
  expect(side.y).toBeLessThan(heading.y + 200);
  expect(heading.x).toBeGreaterThan(side.x + side.width);

  // Breadcrumbs say where you are, and "Admin" goes back to the Overview.
  await expect(crumbs).toContainText("Admin");
  await menu.getByRole("link", { name: /Branding/ }).click();
  await expect(page).toHaveURL(/\/hq\/branding$/);
  await expect(crumbs.getByRole("listitem").last()).toHaveText("Branding");
  await crumbs.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/hq$/);

  // The Overview is made of panels, and they are flat: an edge, no shadow.
  const cards = page.locator(".hq-card");
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  expect(await cards.first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");

  // On a phone the same menu lies along the top, and no page scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/hq", "/hq/approvals", "/hq/invites", "/hq/branding", "/hq/email"]) {
    await page.goto(path);
    const strip = (await menu.boundingBox())!;
    expect(strip.width, path).toBeLessThanOrEqual(390);
    expect(strip.y, path).toBeLessThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
});
