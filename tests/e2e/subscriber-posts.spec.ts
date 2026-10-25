import { createHmac } from "node:crypto";
import { type Page } from "@playwright/test";
import { E2E } from "./constants";
import { expect, test } from "./fixtures";
import { sendPost, signUpMember } from "./helpers";

// Serial: each step uses what the one before made, and the last one puts everything back. Nothing here calls Polar:
// the keys are made-up and Polar's messages are posted to our own webhook address, signed with the made-up secret.
test.describe.configure({ mode: "serial" });

const TOKEN = `polar_oat_${"faketoken".repeat(3)}`;
const SECRET = `whsec_${"fakesecret".repeat(3)}`;
const STAMP = Date.now().toString(36);
const LOCKED_WORD = `kiwi${STAMP}`;
const OPEN_WORD = `banana${STAMP}`;

let member: Page;
let closeMember: () => Promise<void>;
let memberId = "";
let adminId = "";
let seq = 0;

const userIdOn = async (page: Page, username: string) => {
  await page.goto(`/${username}`);
  const src = await page.locator(".profile-avatar img").getAttribute("src");
  return /\/avatar\/(usr_[0-9A-Za-z]{24})/.exec(src ?? "")![1]!;
};

async function polar(page: Page, event: unknown) {
  const body = JSON.stringify(event);
  const id = `msg_${Date.now()}_${++seq}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(SECRET)).update(`${id}.${ts}.${body}`).digest("base64");
  return page.request.post("/api/webhooks/polar", { data: body, headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } });
}

const subscription = (over: Record<string, unknown> = {}) => ({
  id: `e2e-sp-${STAMP}`,
  created_at: "2026-10-01T12:00:00Z",
  modified_at: new Date(Date.now() + 1000 * ++seq).toISOString(),
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

const send = async (page: Page, data: unknown) => {
  const res = await polar(page, { type: "subscription.updated", timestamp: new Date().toISOString(), data });
  expect(res.status()).toBe(200);
};

test.beforeAll(async ({ browser }) => {
  const m = await signUpMember(browser, "198.18.62.1", { first: "Pat", last: "Reader" });
  member = m.page;
  closeMember = () => m.context.close();
  memberId = await userIdOn(member, m.username);
});

test.afterAll(async () => {
  await closeMember();
});

test("the choice of who can see a post shows only once there is a price, and a post can be for subscribers only", async ({ page }) => {
  adminId = await userIdOn(page, E2E.admin.username);

  // Subscriptions off: no choice.
  await page.goto("/compose");
  await expect(page.getByRole("group", { name: "Who can see this" })).toHaveCount(0);

  await page.goto("/hq/money/setup");
  await page.getByLabel("Polar access token").fill(TOKEN);
  await page.getByLabel("Polar webhook secret").fill(SECRET);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Keys saved", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Members can offer subscriptions" }).click();
  await expect(page.getByText("Subscriptions are on.")).toBeVisible();

  // On, but no price yet: still no choice.
  await page.goto("/compose");
  await expect(page.getByRole("group", { name: "Who can see this" })).toHaveCount(0);

  await page.goto("/subscriptions/price");
  await page.getByLabel("Price a month, in US dollars").fill("5");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText(/Your profile now has a Subscribe button/)).toBeVisible();

  await page.goto("/compose");
  const audience = page.getByRole("group", { name: "Who can see this" });
  await expect(audience.getByRole("radio", { name: "Everyone" })).toBeChecked();
  await page.getByLabel("Your post").fill(`Everyone can read this ${OPEN_WORD}`);
  await sendPost(page);

  await page.goto("/compose");
  await page.getByRole("radio", { name: "Subscribers only" }).check({ force: true });
  await expect(page.getByRole("radio", { name: "Subscribers only" })).toBeChecked();
  await page.getByLabel("Your post").fill(`Only subscribers read this ${LOCKED_WORD}`);
  await sendPost(page);

  // The author sees both, and a label on the one for subscribers.
  await page.goto(`/${E2E.admin.username}`);
  const mine = page.getByRole("article").filter({ hasText: LOCKED_WORD });
  await expect(mine).toBeVisible();
  await expect(mine.getByText("Subscribers only")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: OPEN_WORD }).getByText("Subscribers only")).toHaveCount(0);
  // It cannot be reposted or quoted: there is no repost button on it, and the quote address finds nothing.
  await expect(mine.getByRole("button", { name: /^Repost/ })).toHaveCount(0);
  const href = await mine.getByRole("link", { name: /Reply/ }).getAttribute("href");
  const postId = /status\/(post_[0-9A-Za-z]{24})/.exec(href ?? "")![1]!;
  expect((await page.goto(`/compose?quote=${postId}`))!.status()).toBe(404);
});

test("someone who does not subscribe sees a locked card, and the words stay out of the feed and search", async ({ page }) => {
  await member.setViewportSize({ width: 412, height: 915 });
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByRole("article").filter({ hasText: OPEN_WORD })).toBeVisible();
  const locked = member.getByRole("article").filter({ hasText: "This post is for subscribers only." });
  await expect(locked).toHaveCount(1);
  await expect(locked.getByRole("button", { name: "Subscribe for $5.00 a month" })).toBeVisible();
  expect((await locked.getByRole("button", { name: /^Subscribe for/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(member.getByText(LOCKED_WORD)).toHaveCount(0);
  // A locked card has no like, save or repost buttons.
  await expect(locked.getByRole("button", { name: /Like|Save post|Repost/ })).toHaveCount(0);
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

  // Not in search, not on the Replies tab.
  // (The search page repeats what was typed, so the check is on post cards.)
  await member.goto(`/search?q=${OPEN_WORD}`);
  await expect(member.getByRole("article").filter({ hasText: OPEN_WORD })).toBeVisible();
  await member.goto(`/search?q=${LOCKED_WORD}`);
  await expect(member.getByText(/No posts found for/)).toBeVisible();
  await expect(member.getByRole("article")).toHaveCount(0);

  // The post's own page is a locked card too: no words, no reply box.
  await page.goto(`/${E2E.admin.username}`);
  const href = await page.getByRole("article").filter({ hasText: LOCKED_WORD }).getByRole("link", { name: /Reply/ }).getAttribute("href");
  await member.goto(href!);
  await expect(member.getByText("This post is for subscribers only.")).toBeVisible();
  await expect(member.getByRole("button", { name: /^Subscribe for/ })).toBeVisible();
  await expect(member.getByText(LOCKED_WORD)).toHaveCount(0);
  await expect(member.getByLabel("Your reply")).toHaveCount(0);
});

test("a paying subscriber reads it, and loses it again when the subscription ends", async ({ page }) => {
  await send(page, subscription());
  await polar(page, {
    type: "order.paid",
    timestamp: new Date().toISOString(),
    data: {
      id: `e2e-spo-${STAMP}`,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      status: "paid",
      paid: true,
      net_amount: 500,
      total_amount: 500,
      tax_amount: 0,
      refunded_amount: 0,
      refunded_tax_amount: 0,
      currency: "usd",
      billing_reason: "subscription_create",
      subscription_id: `e2e-sp-${STAMP}`,
      metadata: {},
    },
  });

  await member.goto(`/${E2E.admin.username}`);
  const post = member.getByRole("article").filter({ hasText: LOCKED_WORD });
  await expect(post).toBeVisible();
  await expect(post.getByText("Subscribers only")).toBeVisible();
  await expect(member.getByText("This post is for subscribers only.")).toHaveCount(0);
  await expect(post.getByRole("button", { name: /^Repost/ })).toHaveCount(0);
  await member.goto(`/search?q=${LOCKED_WORD}`);
  await expect(member.getByRole("article").filter({ hasText: LOCKED_WORD })).toBeVisible();

  // They can answer it, and the answer is for subscribers too.
  const href = await (async () => {
    await member.goto(`/${E2E.admin.username}`);
    return post.getByRole("link", { name: /Reply/ }).getAttribute("href");
  })();
  await member.goto(href!);
  await member.getByLabel("Your reply").fill(`A subscriber answers ${STAMP}`);
  await member.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(member.getByRole("region", { name: "Replies" }).getByText(`A subscriber answers ${STAMP}`)).toBeVisible();

  // The subscription ends (Polar says so): the card is back, and so is the empty search.
  await send(page, subscription({ status: "canceled", current_period_end: new Date(Date.now() - 10 * 86_400_000).toISOString() }));
  await member.goto(`/${E2E.admin.username}`);
  await expect(member.getByText(LOCKED_WORD)).toHaveCount(0);
  await expect(member.getByText("This post is for subscribers only.")).toHaveCount(1);
  await member.goto(`/search?q=${LOCKED_WORD}`);
  await expect(member.getByRole("article")).toHaveCount(0);
});

test("put everything back", async ({ page }) => {
  await page.goto(`/${E2E.admin.username}`);
  for (const word of [LOCKED_WORD, OPEN_WORD]) {
    const card = page.getByRole("article").filter({ hasText: word });
    await card.getByRole("button", { name: "More options" }).click();
    await card.getByRole("button", { name: "Delete post" }).click();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("article").filter({ hasText: word })).toHaveCount(0);
  }
  await page.goto("/subscriptions/price");
  await page.getByRole("button", { name: "Stop offering" }).click();
  await expect(page.getByText(/Nobody new can subscribe/)).toBeVisible();
  await page.goto("/hq/money/setup");
  await page.getByRole("switch", { name: "Members can offer subscriptions" }).click();
  await expect(page.getByText("Subscriptions are off.")).toBeVisible();
  await page.getByRole("button", { name: "Remove the keys" }).click();
  await page.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
});
