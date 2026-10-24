import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { E2E } from "./constants";
import { signUpMember } from "./helpers";

// Serial: later tests use the pictures chosen by earlier ones. Uses its own member, so the
// admin's profile (which other specs read) is not touched.
test.describe.configure({ mode: "serial" });

// A real 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let member: Page;
let username = "";
let closeMember: () => Promise<void>;

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.30.1", { first: "Pia", last: "Picture" });
  member = m.page;
  username = m.username;
  closeMember = () => m.context.close();
});

test.afterAll(async () => {
  await closeMember();
});

const imageLoaded = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);

test("a member without a picture gets a drawn default that really loads, with no outside request", async () => {
  const requests: string[] = [];
  member.on("request", (r) => requests.push(r.url()));

  await member.goto(`/${username}`);
  const avatar = member.locator("img.avatar").first();
  await expect(avatar).toHaveAttribute("src", /\/avatar\/usr_[0-9A-Za-z]{24}$/);
  await expect.poll(() => imageLoaded(member, "img.avatar")).toBe(true);

  const origin = new URL(member.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"))).toEqual([]);

  const res = await member.request.get(await avatar.evaluate((el) => (el as HTMLImageElement).src));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/svg+xml");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a default for an unknown or malformed id is a plain not found", async ({ page }) => {
  expect((await page.request.get(`/avatar/usr_${"z".repeat(24)}`)).status()).toBe(404);
  expect((await page.request.get("/avatar/not-an-id")).status()).toBe(404);
});

test("I can upload a profile picture and a cover, save, and see them on my profile and on my posts", async () => {
  await member.goto("/profile");
  await member.getByLabel("Profile picture").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await member.getByLabel("Cover picture").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  await expect(member.getByRole("button", { name: "Remove" })).toHaveCount(2);
  await member.getByRole("button", { name: "Save" }).click();
  await expect(member.getByRole("status")).toContainText("Saved");

  await member.goto(`/${username}`);
  await expect(member.locator("img.avatar").first()).toHaveAttribute("src", /\/media\/avatars\/usr_[0-9A-Za-z]{24}\/[0-9A-Za-z]{24}\.png$/);
  await expect(member.locator("img.banner-img").first()).toHaveAttribute("src", /\/media\/banners\/usr_[0-9A-Za-z]{24}\/[0-9A-Za-z]{24}\.png$/);
  await expect.poll(() => imageLoaded(member, "img.avatar")).toBe(true);
  await expect.poll(() => imageLoaded(member, "img.banner-img")).toBe(true);

  // The cover keeps its 3 to 1 shape, and the picture is on the person's posts too.
  const box = (await member.locator("img.banner-img").first().boundingBox())!;
  expect(Math.round((box.width / box.height) * 10) / 10).toBe(3);

  await member.goto("/compose");
  await member.getByLabel("Your post").fill(`pictures ${Date.now().toString(36)}`);
  await member.getByRole("button", { name: "Post", exact: true }).click();
  await expect(member.getByRole("article").first().locator("img.avatar")).toHaveAttribute("src", /\/media\/avatars\//);
});

test("an uploaded picture is served as an image that can be cached for ever and never run as a page", async () => {
  await member.goto(`/${username}`);
  const src = await member.locator("img.avatar").first().getAttribute("src");
  const res = await member.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["cache-control"]).toContain("immutable");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toContain("sandbox");
});

test("only the picture folders are served, and unknown pictures are not found", async ({ page }) => {
  for (const path of [
    `/media/avatars/usr_${"a".repeat(24)}/${"b".repeat(24)}.png`,
    "/media/instance/logo.png",
    "/media/fonts/inter.woff2",
    "/media/avatars/../instance/logo.png",
    "/media/nonsense",
  ]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("a file that is not a picture, or is too big, is refused with a plain message", async () => {
  await member.goto("/profile");

  await member.getByLabel("Profile picture").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<svg><script>alert(1)</script></svg>") });
  await expect(member.getByText("Use a JPEG, PNG, WebP or GIF picture.")).toBeVisible();

  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1, 1)]);
  await member.getByLabel("Profile picture").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
  await expect(member.getByText(/too big.*2 MB/)).toBeVisible();
});

test("removing a picture goes back to the default", async () => {
  await member.goto("/profile");
  await member.getByRole("button", { name: "Remove" }).first().click();
  await member.getByRole("button", { name: "Remove" }).first().click();
  await member.getByRole("button", { name: "Save" }).click();
  await expect(member.getByRole("status")).toContainText("Saved");

  await member.goto(`/${username}`);
  await expect(member.locator("img.avatar").first()).toHaveAttribute("src", /\/avatar\/usr_/);
  await expect(member.locator("img.banner-img.banner-flat, div.banner-flat").first()).toBeVisible();
});

test("the upload endpoint needs a session and refuses forms sent from another site", async ({ playwright, baseURL }) => {
  // An empty storage state: the project's stored admin login is otherwise inherited.
  const anonymous = await playwright.request.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } });
  const noSession = await anonymous.post("/api/upload", { multipart: { kind: "avatar", file: { name: "a.png", mimeType: "image/png", buffer: PNG } } });
  expect(noSession.status()).toBe(401);
  await anonymous.dispose();

  const signedIn = await playwright.request.newContext({ baseURL: baseURL!, storageState: E2E.authFile });
  const foreign = await signedIn.post("/api/upload", {
    headers: { origin: "https://evil.example" },
    multipart: { kind: "avatar", file: { name: "a.png", mimeType: "image/png", buffer: PNG } },
  });
  expect(foreign.status()).toBe(403);

  const badKind = await signedIn.post("/api/upload", { multipart: { kind: "reel", file: { name: "a.png", mimeType: "image/png", buffer: PNG } } });
  expect(badKind.status()).toBe(400);
  await signedIn.dispose();
});
