import { expect, test } from "./fixtures";
import { adminInviteLink } from "./helpers";

// A person invited by email arrives with their address after the "#" of the link, so the Email box is already filled in.
// The part after the "#" never reaches the server, which is why it is allowed to hold an address (CLAUDE.md rule 2).
// Only the sign-up form is opened here; nobody signs up, so the sign-up limits are not used.

const ADDRESS = "sam.invited@example.com";
const hint = (address: string) => `#email=${encodeURIComponent(address)}`;

test("the Email box is filled in from the invitation, and the address leaves the address bar", async ({ browser }) => {
  const link = await adminInviteLink(browser);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  // The welcome screen first; its button carries the address on to the form.
  await page.goto(`${link}${hint(ADDRESS)}`);
  await page.getByRole("link", { name: /^Join / }).click();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(ADDRESS);
  await expect.poll(() => new URL(page.url()).hash).toBe("");

  // Nothing the browser asked the server for held the address.
  expect(requested.filter((url) => url.includes("sam.invited") || url.includes("sam%2Einvited") || url.includes("example.com")), "requests that name the address").toEqual([]);
  await context.close();
});

test("the form opened directly from the link has it too, in lower case, and the box can still be changed", async ({ browser }) => {
  const link = await adminInviteLink(browser);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`${link}&join=1${hint("  Sam.Invited@Example.COM ")}`);
  const email = page.getByLabel("Email");
  await expect(email).toHaveValue(ADDRESS);
  await email.fill("someone.else@example.com");
  await expect(email).toHaveValue("someone.else@example.com");
  await context.close();
});

test("an ordinary link, or one with something that is not an address, leaves the box empty", async ({ browser }) => {
  const link = await adminInviteLink(browser);
  for (const suffix of ["", "#email=nobody", "#email=%3Cscript%3E", "#other=sam%40example.com"]) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`${link}&join=1${suffix}`);
    await expect(page.getByLabel("First name")).toBeVisible();
    await expect(page.getByLabel("Email"), suffix || "plain link").toHaveValue("");
    await context.close();
  }
});
