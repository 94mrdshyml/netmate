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

  await page.goto("/hq/money/setup");
  await page.getByLabel("Polar access token").fill(TOKEN);
  await page.getByLabel("Polar webhook secret").fill(SECRET);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Keys saved", { exact: true })).toBeVisible();

  const toggle = page.getByRole("switch", { name: "Members can offer subscriptions" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Subscriptions are on.")).toBeVisible();

  // Polar's fee: the owner's own rate, checked before it is saved.
  await page.getByLabel("Percent of each payment").fill("25");
  await page.getByRole("button", { name: "Save fee" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The most is 20%." })).toBeVisible();
  await page.getByLabel("Percent of each payment").fill("4.50");
  await page.getByLabel("Plus a fixed amount (US dollars)").fill("0.40");
  await page.getByRole("button", { name: "Save fee" }).click();
  await expect(page.getByText("Saved.").last()).toBeVisible();

  // Members now have a Subscriptions row in Settings, with three tabs inside; the admin sets a price on My price.
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Subscriptions/ }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  const tabs = page.getByRole("navigation", { name: "Subscriptions" });
  await expect(tabs.getByRole("link")).toHaveText(["People I pay", "My subscribers", "My price"]);
  await expect(tabs.getByRole("link", { name: "People I pay" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "My price" }).click();
  await expect(page).toHaveURL(/\/subscriptions\/price$/);
  await expect(page.getByText("Test mode: no real money moves.")).toBeVisible();
  await expect(page.getByText(/You earn 50% of each payment/)).toBeVisible();
  await page.getByLabel("Price a month, in US dollars").fill("0.50");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "lowest price is $1.00" })).toBeVisible();
  await page.getByLabel("Price a month, in US dollars").fill("5");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText(/Your profile now has a Subscribe button/)).toBeVisible();
  await tabs.getByRole("link", { name: "My subscribers" }).click();
  await expect(page.getByText("Nobody is subscribed to you yet.")).toBeVisible();
  // The old address leads to the same place.
  await page.goto("/subscription");
  await expect(page).toHaveURL(/\/subscriptions\/earnings$/);
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
    net_amount: 425,
    total_amount: 500,
    tax_amount: 75,
    refunded_amount: 0,
    refunded_tax_amount: 0,
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
  await expect(page).toHaveURL(/\/subscriptions\/earnings$/);

  // The creator sees who subscribed and what they have earned from them: 50% of the $4.25 left after the $0.75 tax is $2.12.
  await page.goto("/subscriptions/earnings");
  await expect(page.getByText("1 person is subscribed to you.")).toBeVisible();
  const person = page.getByRole("listitem").filter({ hasText: "Sam Subscriber" });
  await expect(person).toContainText("Subscribed");
  await expect(person).toContainText("$5.00 a month");
  await expect(person).toContainText("You have earned $2.12 from them.");
  await expect(page.getByRole("img", { name: /What you earned each month/ })).toBeVisible();
  await expect(page.locator(".sub-figures")).toContainText("Earned in total$2.12");
  await expect(page.locator(".sub-figures")).toContainText("Still to be paid$2.12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
});

test("the owner sees where the money went, records a payout, and can take it back", async ({ page }) => {
  await page.goto("/hq/money");
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await expect(page.getByText(/Test mode: these are practice payments/)).toBeVisible();

  // $5.00 collected, $0.75 tax, Polar's fee 4.50% of $4.25 (19 cents) plus 40 cents = $0.59, member $2.12, owner keeps $1.54.
  const stats = page.locator(".hq-stats");
  await expect(stats).toContainText("Collected$5.00");
  await expect(stats).toContainText("Reaches you$3.66");
  await expect(stats).toContainText("Members are owed$2.12");
  await expect(stats).toContainText("Yours to keep$1.54");
  const ledger = page.getByRole("table", { name: "From what was collected to what you keep" });
  await expect(ledger.getByRole("row", { name: /^Tax/ })).toContainText("$0.75");
  await expect(ledger.getByRole("row", { name: /^Polar's fee/ })).toContainText("$0.59");
  await expect(ledger.getByRole("row", { name: /^Yours to keep/ })).toContainText("$1.54");
  // The graph says it in words too, and the month table has the numbers.
  await expect(page.getByRole("img", { name: /^Of \$5\.00 collected: tax \$0\.75, polar's fee \$0\.59, members \$2\.12, yours \$1\.54\./i })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Collected each month:/ })).toBeVisible();
  await expect(page.getByRole("table").filter({ hasText: "Polar's fee" }).last()).toContainText("$5.00");

  // A member with a balance has a payout form (on the Members and payouts tab); asking for more than is owed is refused.
  await page.getByRole("navigation", { name: "Money" }).getByRole("link", { name: "Members and payouts" }).click();
  await expect(page).toHaveURL(/\/hq\/money\/payouts$/);
  const row = page.getByRole("listitem").filter({ hasText: "Riya Sen" }).first();
  await expect(row).toContainText("$2.12 owed");
  await expect(row).toContainText("1 subscriber");
  const form = row.getByRole("form", { name: "Record a payout to Riya Sen" });
  await form.getByLabel("Amount paid (US dollars)").fill("2.13");
  await form.getByRole("button", { name: "Record payout" }).click();
  await expect(form.getByRole("alert")).toContainText("That is more than they are owed ($2.12).");

  await form.getByLabel("Amount paid (US dollars)").fill("1.00");
  await form.getByLabel("Note (optional)").fill("Bank transfer, e2e");
  await form.getByRole("button", { name: "Record payout" }).click();
  await expect(row).toContainText("$1.12 owed");
  await expect(page.getByRole("list", { name: "Recorded payouts" })).toContainText("$1.00 to Riya Sen");
  await expect(page.getByRole("list", { name: "Recorded payouts" })).toContainText("Bank transfer, e2e");
  await expect(page.locator(".hq-stats")).toContainText("Members are owed$1.12");
  // The yours-to-keep number does not move: a payout is money that was already the member's.
  await expect(page.locator(".hq-stats")).toContainText("Yours to keep$1.54");

  // The member sees it as theirs, with the note.
  await page.goto("/subscriptions/earnings");
  await expect(page.locator(".sub-figures")).toContainText("Paid to you$1.00");
  await expect(page.locator(".sub-figures")).toContainText("Still to be paid$1.12");
  await expect(page.getByRole("list", { name: "Paid to you" })).toContainText("Bank transfer, e2e");

  // Taking it back asks first, keeps the record, and gives the balance back.
  await page.goto("/hq/money/payouts");
  const payout = page.getByRole("list", { name: "Recorded payouts" }).getByRole("listitem").first();
  await payout.getByRole("button", { name: "Void" }).click();
  await payout.getByRole("button", { name: "Yes, void it" }).click();
  await expect(payout).toContainText("Voided");
  await expect(page.locator(".hq-stats")).toContainText("Members are owed$2.12");
  await page.goto("/subscriptions/earnings");
  await expect(page.locator(".sub-figures")).toContainText("Paid to you$0.00");

  // Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hq/money");
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 412, height: 915 });
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
  await page.goto("/subscriptions/price");
  await page.getByRole("button", { name: "Stop offering" }).click();
  await expect(page.getByText(/Nobody new can subscribe/)).toBeVisible();

  await page.goto("/hq/money/setup");
  await page.getByRole("switch", { name: "Members can offer subscriptions" }).click();
  await expect(page.getByText("Subscriptions are off.")).toBeVisible();
  await page.getByRole("button", { name: "Remove the keys" }).click();
  await page.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();

  // With the feature off, members see none of it, and the webhook address does not exist.
  await member.goto("/settings");
  await expect(member.getByRole("link", { name: /^Subscriptions/ })).toHaveCount(0);
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("button", { name: /^Subscribe for/ })).toHaveCount(0);
  expect((await polar(page, { type: "x", data: {} })).status()).toBe(404);
});
