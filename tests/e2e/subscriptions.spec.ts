import { createHmac } from "node:crypto";
import { type Page } from "@playwright/test";
import { E2E } from "./constants";
import { expect, test } from "./fixtures";
import { signUpMember } from "./helpers";

// Serial: each step uses what the one before made, and the last one puts everything back. Nothing here calls Polar:
// the keys are made-up, "Subscribe" is not pressed, and Polar's messages are posted to our own webhook address,
// signed with the made-up secret, the way Polar would.
test.describe.configure({ mode: "serial" });

const TOKEN = `polar_oat_${"faketoken".repeat(3)}`;
const SECRET = `whsec_${"fakesecret".repeat(3)}`;

let member: Page;
let closeMember: () => Promise<void>;
let memberId = "";
let adminId = "";
let polarSeq = 0;

const userIdOn = async (page: Page, username: string) => {
  await page.goto(`/${username}`);
  const src = await page.locator(".profile-avatar img").getAttribute("src");
  return /\/avatar\/(usr_[0-9A-Za-z]{24})/.exec(src ?? "")![1]!;
};

/** Posts a message to our webhook address, signed the way Polar signs. */
async function polar(page: Page, event: unknown, opts: { secret?: string } = {}) {
  const body = JSON.stringify(event);
  const id = `msg_${Date.now()}_${++polarSeq}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(opts.secret ?? SECRET)).update(`${id}.${ts}.${body}`).digest("base64");
  return page.request.post("/api/webhooks/polar", { data: body, headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } });
}

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "e2e-sub-1",
  created_at: "2026-10-01T12:00:00Z",
  modified_at: new Date(Date.now() + 1000 * ++polarSeq).toISOString(),
  amount: 500,
  currency: "usd",
  recurring_interval: "month",
  recurring_interval_count: 1,
  status: "active",
  current_period_start: "2026-10-01T12:00:00Z",
  current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  cancel_at_period_end: false,
  metadata: { netmate_subscriber: memberId, netmate_creator: adminId },
  ...over,
});

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.61.1", { first: "Sam", last: "Subscriber" });
  member = m.page;
  closeMember = () => m.context.close();
  memberId = await userIdOn(member, m.username);
});

test.afterAll(async () => {
  await closeMember();
});

test("the admin saves the Polar keys, turns subscriptions on and sets a price", async ({ page }) => {
  adminId = await userIdOn(page, E2E.admin.username);

  await page.goto("/hq/payments");
  await page.getByLabel("Polar access token").fill(TOKEN);
  await page.getByLabel("Polar webhook secret").fill(SECRET);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Keys saved", { exact: true })).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Members can offer subscriptions" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Subscriptions are on.")).toBeVisible();

  // Members now have the two rows in Settings; the admin sets a price.
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Your subscriptions/ })).toBeVisible();
  await page.getByRole("link", { name: /^Subscription price/ }).click();
  await expect(page.getByText("Test mode: no real money moves.")).toBeVisible();
  await expect(page.getByText(/You earn 50% of each payment/)).toBeVisible();
  await page.getByLabel("Price a month, in US dollars").fill("0.50");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "lowest price is $1.00" })).toBeVisible();
  await page.getByLabel("Price a month, in US dollars").fill("5");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText(/Your profile now has a Subscribe button/)).toBeVisible();
  await expect(page.getByText("Nobody is subscribed to you yet.")).toBeVisible();
});

test("a member sees the Subscribe button with the price, and where they will pay", async () => {
  await member.setViewportSize({ width: 412, height: 915 });
  await member.goto(`/${E2E.admin.username}`);
  const button = member.getByRole("button", { name: "Subscribe for $5.00 a month" });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(member.getByText(/You pay on Polar.s secure page/)).toBeVisible();
  await expect(member.getByText(/Test mode: no real money moves/)).toBeVisible();
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  // The member has the settings rows and an empty list; the page Polar sends people back to says it is confirming.
  await member.goto("/subscriptions");
  await expect(member.getByText("You are not subscribed to anyone.")).toBeVisible();
  await member.goto(`/subscribe/done?creator=${E2E.admin.username}&checkout_id=whatever`);
  await expect(member.getByRole("heading", { name: "Confirming your payment" })).toBeVisible();
  // Nothing in the address can make it say they are subscribed.
  await member.goto(`/subscribe/done?creator=nobody_here_at_all`);
  await expect(member.getByRole("heading", { name: "Confirming your payment" })).toBeVisible();
});

test("Polar's signed messages make a subscription, and unsigned ones do nothing", async ({ page }) => {
  const created = { type: "subscription.created", timestamp: new Date().toISOString(), data: subscription() };

  // Not signed by Polar: refused, nothing happens.
  expect((await polar(page, created, { secret: `${SECRET}x` })).status()).toBe(401);
  expect((await page.request.post("/api/webhooks/polar", { data: "{}" })).status()).toBe(401);
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("button", { name: /^Subscribe for/ })).toBeVisible();

  // Signed: a subscription, and its first payment.
  const ok = await polar(page, created);
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ ok: true, handled: true });
  const order = {
    id: "e2e-order-1",
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
    status: "paid",
    paid: true,
    net_amount: 500,
    refunded_amount: 0,
    currency: "usd",
    billing_reason: "subscription_create",
    subscription_id: "e2e-sub-1",
    metadata: {},
  };
  expect(await (await polar(page, { type: "order.paid", timestamp: new Date().toISOString(), data: order })).json()).toEqual({ ok: true, handled: true });

  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByText("You are subscribed.")).toBeVisible();
  await expect(member.getByText(/It renews on/)).toBeVisible();
  await expect(member.getByRole("button", { name: /^Subscribe for/ })).toHaveCount(0);

  await member.goto(`/subscribe/done?creator=${E2E.admin.username}`);
  await expect(member.getByRole("heading", { name: /You are subscribed to Riya Sen/ })).toBeVisible();

  // The creator is told, once, with a link to the subscription page.
  await page.goto("/notifications");
  const alert = page.getByRole("listitem").filter({ hasText: "Sam Subscriber subscribed to you" });
  await expect(alert).toHaveCount(1);
  await alert.getByRole("link").click();
  await expect(page).toHaveURL(/\/subscription$/);

  // The creator sees a number, not a name.
  await expect(page.getByText("1 person is subscribed to you.")).toBeVisible();
  await expect(page.getByText("Sam Subscriber")).toHaveCount(0);
});

test("a subscriber can see and stop their subscription, which asks first", async () => {
  await member.goto("/subscriptions");
  const row = member.getByRole("listitem").filter({ hasText: "Riya Sen" });
  await expect(row).toContainText("$5.00 a month");
  await expect(row).toContainText("Renews on");
  await row.getByRole("button", { name: "Stop subscribing to Riya Sen" }).click();
  await expect(row.getByRole("group", { name: "Stop subscribing to Riya Sen?" })).toBeVisible();
  for (const control of await row.getByRole("button").all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await row.getByRole("button", { name: "Keep it" }).click();
  await expect(row.getByRole("button", { name: "Stop subscribing to Riya Sen" })).toBeVisible();
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
});

test("when Polar says it ended, the subscription is gone; then everything is put back", async ({ page }) => {
  expect(
    (await polar(page, { type: "subscription.revoked", timestamp: new Date().toISOString(), data: subscription({ status: "canceled", cancel_at_period_end: true, modified_at: new Date(Date.now() + 3_600_000).toISOString() }) })).status(),
  ).toBe(200);
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("button", { name: "Subscribe for $5.00 a month" })).toBeVisible();
  await expect(member.getByText("You are subscribed.")).toHaveCount(0);
  await member.goto("/subscriptions");
  await expect(member.getByText("You are not subscribed to anyone.")).toBeVisible();

  // Put back: stop offering, switch off, forget the keys.
  await page.goto("/subscription");
  await page.getByRole("button", { name: "Stop offering" }).click();
  await expect(page.getByText(/Nobody new can subscribe/)).toBeVisible();

  await page.goto("/hq/payments");
  await page.getByRole("switch", { name: "Members can offer subscriptions" }).click();
  await expect(page.getByText("Subscriptions are off.")).toBeVisible();
  await page.getByRole("button", { name: "Remove the keys" }).click();
  await page.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();

  // With the feature off, members see none of it, and the webhook address does not exist.
  await member.goto("/settings");
  await expect(member.getByRole("link", { name: /^Your subscriptions/ })).toHaveCount(0);
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("button", { name: /^Subscribe for/ })).toHaveCount(0);
  expect((await polar(page, { type: "x", data: {} })).status()).toBe(404);
});
