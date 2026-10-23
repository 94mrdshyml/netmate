import { expect, test } from "@playwright/test";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";
import { solidPng } from "./png";

// Serial, and every test puts the original look back: other specs read the name, so a change is
// held for as short a time as possible.
test.describe.configure({ mode: "serial" });

const restore = async (page: import("@playwright/test").Page) => {
  await page.goto("/hq/branding");
  await page.getByLabel("Name", { exact: true }).fill(E2E.instance.name);
  await page.locator("#primary").fill(E2E.instance.primary);
  await page.getByRole("radio", { name: "Round" }).check();
  await page.getByLabel("Font").selectOption("Inter");
  await page.getByRole("radio", { name: "initials" }).check();
  // Only the logo and favicon have a Remove button.
  const remove = page.getByRole("button", { name: "Remove" });
  while ((await remove.count()) > 0) await remove.first().click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
};

test("the form starts with the saved look and the preview follows what is typed", async ({ page }) => {
  await page.goto("/hq/branding");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);
  await expect(page.locator("#primary")).toHaveValue(E2E.instance.primary);
  await expect(page.getByTestId("preview-light")).toContainText(E2E.instance.name);

  await page.getByLabel("Name", { exact: true }).fill("Preview Only");
  await expect(page.getByTestId("preview-light")).toContainText("Preview Only");
  await expect(page.getByTestId("preview-dark")).toContainText("Preview Only");

  // Typing is not saving: a fresh load still shows the saved name.
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);

  await page.locator("#primary").fill("#FFFF00");
  await expect(page.locator("#primary-note")).toContainText("We adjust this colour slightly in light");
  const lightButton = await page.getByTestId("preview-light").getByRole("button").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lightButton).not.toBe("rgb(255, 255, 0)");
});

test("bad answers are explained and nothing is saved", async ({ page }) => {
  await page.goto("/hq/branding");
  await page.getByLabel("Name", { exact: true }).fill("   ");
  await page.locator("#primary").fill("red");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Some answers need fixing." })).toBeVisible();
  await expect(page.locator("#name-note")).toContainText("Enter a name");
  await expect(page.locator("#primary-note")).toContainText("Pick a colour");

  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(E2E.instance.name);
});

test("saving changes the name, colour and corners for everyone at once, and putting it back works", async ({ page, browser }) => {
  try {
    await page.goto("/hq/branding");
    await page.getByLabel("Name", { exact: true }).fill("Riverbank");
    await page.locator("#primary").fill("#C2410C");
    await page.getByRole("radio", { name: "Square" }).check();
    await page.getByRole("radio", { name: "pixel art neutral" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    // The admin header uses the new name straight away.
    await expect(page.getByText("Riverbank admin")).toBeVisible();

    // A signed-out visitor sees the new name and the new theme variables, with no redeploy.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await visitor.newPage();
    await guest.goto("/sign-in");
    await expect(guest.getByText("Welcome back to Riverbank")).toBeVisible();
    const css = await guest.locator("#instance-theme").evaluate((el) => el.textContent ?? "");
    expect(css).toContain("--radius:0px");
    expect(css).toMatch(/--brand-text:#[0-9a-f]{6}/i);
    await visitor.close();

    // And it survives a reload of the form.
    await page.goto("/hq/branding");
    await expect(page.locator("#primary")).toHaveValue("#C2410C");
    await expect(page.getByRole("radio", { name: "Square" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "pixel art neutral" })).toBeChecked();
  } finally {
    await restore(page);
  }

  // Back to what setup chose (theme.spec reads it): name, colour and the Round corners.
  await page.goto("/hq/branding");
  await expect(page.getByRole("radio", { name: "Round" })).toBeChecked();
  await expect(page.getByText(`${E2E.instance.name} admin`)).toBeVisible();
});

test("the default avatar styles are drawn on our own server, with no request to another site", async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== new URL(baseURL!).origin) outside.push(u);
  });
  await page.goto("/hq/branding");
  const samples = page.locator(".avatar-choice img");
  await expect(samples).toHaveCount(8);
  for (const img of await samples.all()) {
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  expect(outside).toEqual([]);
});

test("a signed-out visitor gets a plain not found on the branding page", async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  expect((await page.goto("/hq/branding"))?.status()).toBe(404);
  await anonymous.close();
});

test("the form fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/branding");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0b6e4f"/></svg>';
const png = (name: string, width: number, height = width) => ({ name, mimeType: "image/png", buffer: solidPng(width, height) });

test("a logo and favicon are uploaded, shown to everyone after Save, and removable", async ({ page, browser }) => {
  try {
    await page.goto("/hq/branding");
    await page.locator("#logo-file").setInputFiles(png("logo.png", 120, 40));
    await expect(page.locator("#logo-note")).toContainText("Applied when you save", { timeout: 15_000 });
    await expect(page.locator(".brand-file-preview").first()).toHaveAttribute("src", /^\/media\/instance\/[0-9A-Za-z]{24}\.png$/);
    await page.locator("#favicon-file").setInputFiles(png("favicon.png", 512));
    await expect(page.locator(".brand-file-preview")).toHaveCount(2, { timeout: 15_000 });

    // Before Save nobody sees them.
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await visitor.newPage();
    await guest.goto("/sign-in");
    await expect(guest.locator("img.brand-logo")).toHaveCount(0);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await guest.goto("/sign-in");
    const logo = guest.locator("img.brand-logo");
    await expect(logo).toHaveAttribute("src", /^\/media\/instance\/[0-9A-Za-z]{24}\.png$/);
    await expect.poll(() => logo.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth === 120)).toBe(true);
    // The name is still there beside the logo.
    await expect(guest.locator(".brand-name")).toContainText(E2E.instance.name);

    const icon = await guest.locator('link[rel="icon"]').first().getAttribute("href");
    expect(icon).toMatch(/^\/media\/instance\/[0-9A-Za-z]{24}\.png$/);
    const file = await guest.request.get(icon!);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/png");
    expect(file.headers()["x-content-type-options"]).toBe("nosniff");
    await visitor.close();
  } finally {
    await restore(page);
  }

  // Removed again: the tab icon is the one drawn from the name and colour.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await visitor.newPage();
  await guest.goto("/sign-in");
  await expect(guest.locator("img.brand-logo")).toHaveCount(0);
  await expect(guest.locator(".brand-chip")).toBeVisible();
  const href = await guest.locator('link[rel="icon"]').first().getAttribute("href");
  expect(href).toBe("/brand-icon");
  const drawn = await guest.request.get("/brand-icon");
  expect(drawn.status()).toBe(200);
  expect(drawn.headers()["content-type"]).toBe("image/svg+xml");
  expect(await drawn.text()).toContain(E2E.instance.name[0]!.toUpperCase());
  await visitor.close();
});

test("an SVG logo is accepted, and one that could run a script is refused with a plain message", async ({ page }) => {
  try {
    await page.goto("/hq/branding");
    await page.locator("#logo-file").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
    await expect(page.locator(".brand-file-preview")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".brand-file-preview")).toHaveAttribute("src", /\.svg$/);

    await page.locator("#favicon-file").setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await expect(page.locator("#favicon-note")).toContainText("cannot be used", { timeout: 15_000 });
    await expect(page.locator(".brand-file-preview")).toHaveCount(1);
  } finally {
    await restore(page);
  }
});

test("a favicon that is too small or not a picture is refused and nothing is attached", async ({ page }) => {
  try {
    await page.goto("/hq/branding");
    await page.locator("#favicon-file").setInputFiles(png("small.png", 128));
    await expect(page.locator("#favicon-note")).toContainText("at least 512", { timeout: 15_000 });
    await page.locator("#favicon-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.locator("#favicon-note")).toContainText("PNG or SVG");
    await expect(page.locator(".brand-file-preview")).toHaveCount(0);
  } finally {
    await restore(page);
  }
});

test("only the admin can upload a logo: a signed-out visitor and a member are turned away", async ({ browser, baseURL }) => {
  const body = { kind: "logo", file: png("logo.png", 64) };

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const signedOut = await visitor.request.post(`${baseURL}/api/upload`, { multipart: body });
  expect(signedOut.status()).toBe(401);
  await visitor.close();

  const member = await signUpMember(browser, "198.18.40.1", { first: "Mem", last: "Ber" });
  const res = await member.page.request.post(`${baseURL}/api/upload`, { multipart: body });
  expect(res.status()).toBe(404);
  await member.context.close();
});

test("the font is kept on our own storage: the page asks no other site for it", async ({ page, browser, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const outside: string[] = [];
  try {
    await page.goto("/hq/branding");
    await page.getByLabel("Font").selectOption("Lora");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const warned = await page.getByRole("status").filter({ hasText: "Could not download the font" }).count();

    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await visitor.newPage();
    guest.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== origin) outside.push(u);
    });
    await guest.goto("/sign-in");
    const css = await guest.locator("#instance-theme").evaluate((el) => el.textContent ?? "");

    if (warned === 0) {
      // Downloaded: the page names files on our own media route and they are real fonts.
      expect(css).toContain('font-family:"Lora"');
      const url = /url\((\/media\/fonts\/lora\/[0-9A-Za-z]{24}\.woff2)\)/.exec(css)?.[1];
      expect(url).toBeTruthy();
      const res = await guest.request.get(url!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("font/woff2");
      expect(css).not.toMatch(/https?:\/\//);
    } else {
      // The download failed (no network): everything else saved, and the page works with the fallback.
      expect(css).not.toContain("@font-face");
      await expect(guest.getByText(`Welcome back to ${E2E.instance.name}`)).toBeVisible();
    }
    await visitor.close();
  } finally {
    await restore(page);
  }
  expect(outside).toEqual([]);
});

test("a stored file that does not exist, or a path trying to climb out, is a plain not found", async ({ request }) => {
  expect((await request.get("/media/instance/aaaaaaaaaaaaaaaaaaaaaaaa.png")).status()).toBe(404);
  expect((await request.get("/media/fonts/lora/aaaaaaaaaaaaaaaaaaaaaaaa.woff2")).status()).toBe(404);
  expect((await request.get("/media/instance/../avatars/x.png")).status()).toBe(404);
});
