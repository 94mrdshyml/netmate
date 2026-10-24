import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { readWebhookHeaders } from "@/payments/webhook";
import { listAlerts, countUnreadAlerts } from "@/server/notifications";
import { savePaymentConnection, savePaymentSplit, setPaymentsEnabled, removePaymentKeys } from "@/server/payments";
import { handlePolarEvent } from "@/server/polar-events";
import { processPolarWebhook } from "@/server/polar-webhook";
import { setBlock } from "@/server/privacy";
import {
  ACCESS_GRACE_MS,
  clearSubscriptionPrice,
  hasSubscriberAccess,
  isPolarUrl,
  listMySubscriptions,
  mySubscriptionSettings,
  setAutoRenew,
  setSubscriptionPrice,
  startCheckout,
  subscribeState,
} from "@/server/subscriptions";

const db = () => getDb(env.DB);
const KEY = "k".repeat(40);
const TOKEN = `polar_oat_${"faketoken".repeat(3)}`;
const SECRET = `whsec_${"fakesecret".repeat(3)}`;
const ORIGIN = "https://space.example";
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

let n = 0;
async function person(over: { status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `sb${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `sub_${i}`, firstName: `Sub${i}`, lastName: "Person", status: over.status ?? "active" });
  return { id, username: `sub_${i}` };
}

async function turnOn(mode: "sandbox" | "production" = "sandbox", percent = 55) {
  await savePaymentConnection(db(), KEY, { mode, accessToken: TOKEN, webhookSecret: SECRET });
  await savePaymentSplit(db(), String(percent));
  await setPaymentsEnabled(db(), KEY, true);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await removePaymentKeys(db());
  await env.DB.prepare("delete from payment_settings").run();
  await env.DB.prepare("delete from subscription_payments").run();
  await env.DB.prepare("delete from subscriptions").run();
  await env.DB.prepare("delete from polar_products").run();
});

// ---- realistic Polar messages (field names from Polar's API description) ----

let seq = 0;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

function subData(o: { polar?: string; sub?: string; creator?: string; status?: string; cancel?: boolean; modified?: number; created?: number; end?: number | null; amount?: number; currency?: string; metadata?: Record<string, unknown> }) {
  return {
    id: o.polar ?? "sub-1",
    created_at: iso(o.created ?? T0),
    modified_at: iso(o.modified ?? T0),
    amount: o.amount ?? 1000,
    currency: o.currency ?? "usd",
    recurring_interval: "month",
    recurring_interval_count: 1,
    status: o.status ?? "active",
    current_period_start: iso(T0),
    current_period_end: o.end === null ? null : iso(o.end ?? T0 + 30 * 86_400_000),
    cancel_at_period_end: o.cancel ?? false,
    customer_id: "cust-1",
    product_id: "prod-1",
    metadata: o.metadata ?? { netmate_subscriber: o.sub, netmate_creator: o.creator },
  };
}
const subEvent = (type: string, data: ReturnType<typeof subData>) => ({ type, timestamp: iso(T0), data });

function orderData(o: { id?: string; polarSub?: string | null; status?: string; net?: number; refunded?: number; modified?: number; reason?: string; currency?: string; sub?: ReturnType<typeof subData> | null }) {
  return {
    id: o.id ?? `order-${++seq}`,
    created_at: iso(T0),
    modified_at: iso(o.modified ?? T0),
    status: o.status ?? "paid",
    paid: true,
    subtotal_amount: o.net ?? 1000,
    discount_amount: 0,
    net_amount: o.net ?? 1000,
    tax_amount: 190,
    total_amount: (o.net ?? 1000) + 190,
    refunded_amount: o.refunded ?? 0,
    refunded_tax_amount: 0,
    currency: o.currency ?? "usd",
    billing_reason: o.reason ?? "subscription_create",
    customer_id: "cust-1",
    subscription_id: o.polarSub === undefined ? "sub-1" : o.polarSub,
    metadata: {},
    subscription: o.sub,
  };
}
const orderEvent = (type: string, data: ReturnType<typeof orderData>) => ({ type, timestamp: iso(T0), data });

const send = (event: unknown, percent = 55, mode: "sandbox" | "production" = "sandbox", fee = { feeBp: 450, feeFixedCents: 40 }) => handlePolarEvent(db(), mode, event, { splitPercent: percent, ...fee });
const subRow = async (polar = "sub-1") => env.DB.prepare("select * from subscriptions where polar_id = ?").bind(polar).first<Record<string, unknown>>();
const payRow = async (order: string) => env.DB.prepare("select * from subscription_payments where polar_order_id = ?").bind(order).first<Record<string, unknown>>();

describe("Polar's subscription messages", () => {
  it("make a subscription from the ids we put on the checkout", async () => {
    const a = await person();
    const b = await person();
    expect(await send(subEvent("subscription.created", subData({ sub: a.id, creator: b.id, amount: 500 })))).toEqual({ kind: "subscription", polarId: "sub-1" });
    expect(await subRow()).toMatchObject({ subscriber_id: a.id, creator_id: b.id, status: "active", price_cents: 500, cancel_at_period_end: 0, mode: "sandbox" });
  });

  it("are safe to receive twice, and a late older one cannot undo a newer one", async () => {
    const a = await person();
    const b = await person();
    const ids = { sub: a.id, creator: b.id };
    await send(subEvent("subscription.created", subData({ ...ids, modified: T0 })));
    await send(subEvent("subscription.created", subData({ ...ids, modified: T0 })));
    expect(await count("select count(*) as n from subscriptions")).toBe(1);

    await send(subEvent("subscription.canceled", subData({ ...ids, cancel: true, modified: T0 + 2000 })));
    expect(await subRow()).toMatchObject({ cancel_at_period_end: 1, status: "active" });
    // The "created" message again, now old: nothing changes.
    await send(subEvent("subscription.created", subData({ ...ids, cancel: false, modified: T0 + 1000 })));
    expect(await subRow()).toMatchObject({ cancel_at_period_end: 1 });

    await send(subEvent("subscription.revoked", subData({ ...ids, status: "canceled", cancel: true, modified: T0 + 3000 })));
    expect(await subRow()).toMatchObject({ status: "canceled" });
    expect(await hasSubscriberAccess(db(), a.id, b.id, T0)).toBe(false);
  });

  it("take their ids only from the first message, so a later one cannot move a subscription to other people", async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    await send(subEvent("subscription.created", subData({ sub: a.id, creator: b.id })));
    await send(subEvent("subscription.updated", subData({ sub: c.id, creator: b.id, modified: T0 + 5000 })));
    expect(await subRow()).toMatchObject({ subscriber_id: a.id, creator_id: b.id });
  });

  it("ignore what is not ours: no ids, unknown people, the same person twice, other money, odd shapes", async () => {
    const a = await person();
    const b = await person();
    const outcome = async (data: ReturnType<typeof subData>) => (await send(subEvent("subscription.created", data))).kind;
    expect(await outcome(subData({ metadata: {} }))).toBe("ignored");
    expect(await outcome(subData({ sub: a.id, creator: "usr_doesnotexist000000000000" }))).toBe("ignored");
    expect(await outcome(subData({ sub: "not an id", creator: b.id }))).toBe("ignored");
    expect(await outcome(subData({ sub: a.id, creator: a.id }))).toBe("ignored");
    expect(await outcome(subData({ sub: a.id, creator: b.id, currency: "eur" }))).toBe("ignored");
    expect(await send({ type: "subscription.created", data: { id: 5 } })).toEqual({ kind: "ignored", reason: "bad_message" });
    expect(await send({ type: "subscription.created", data: subData({ sub: a.id, creator: b.id, status: "made_up" }) })).toEqual({ kind: "ignored", reason: "bad_message" });
    expect(await send("nonsense")).toEqual({ kind: "ignored", reason: "bad_message" });
    expect(await send({ type: "customer.created", data: {} })).toEqual({ kind: "ignored", reason: "other_event" });
    expect(await count("select count(*) as n from subscriptions")).toBe(0);
  });
});

describe("Polar's payment messages", () => {
  async function started(amount = 1000) {
    const a = await person();
    const b = await person();
    await send(subEvent("subscription.created", subData({ sub: a.id, creator: b.id, amount })));
    return { a, b };
  }

  it("record the member's share at the split in force, before tax", async () => {
    const { a, b } = await started();
    expect(await send(orderEvent("order.paid", orderData({ id: "o-1", net: 1000 })), 55)).toEqual({ kind: "payment", polarOrderId: "o-1" });
    expect(await payRow("o-1")).toMatchObject({ creator_id: b.id, subscriber_id: a.id, net_cents: 1000, refunded_cents: 0, split_percent: 55, creator_cents: 550, mode: "sandbox" });
  });

  it("are safe to receive twice, and repeat the same share", async () => {
    await started();
    for (let i = 0; i < 3; i++) await send(orderEvent("order.paid", orderData({ id: "o-2" })));
    expect(await count("select count(*) as n from subscription_payments")).toBe(1);
    expect(await payRow("o-2")).toMatchObject({ creator_cents: 550 });
  });

  it("take a refund back at the rate the payment earned, even after the split changed", async () => {
    await started();
    await send(orderEvent("order.paid", orderData({ id: "o-3", net: 1000, modified: T0 })), 55);
    // The owner changes the split to 10; a refund of half still comes off at the stored 55.
    await send(orderEvent("order.updated", orderData({ id: "o-3", net: 1000, refunded: 500, status: "partially_refunded", modified: T0 + 1000 })), 10);
    expect(await payRow("o-3")).toMatchObject({ split_percent: 55, refunded_cents: 500, creator_cents: 275 });
    await send(orderEvent("order.refunded", orderData({ id: "o-3", net: 1000, refunded: 1000, status: "refunded", modified: T0 + 2000 })), 10);
    expect(await payRow("o-3")).toMatchObject({ creator_cents: 0 });
    // A late older message cannot bring the money back.
    await send(orderEvent("order.paid", orderData({ id: "o-3", net: 1000, modified: T0 })), 55);
    expect(await payRow("o-3")).toMatchObject({ refunded_cents: 1000, creator_cents: 0 });
  });

  it("a payment that arrives before its subscription's own message still works", async () => {
    const a = await person();
    const b = await person();
    const sub = subData({ polar: "sub-early", sub: a.id, creator: b.id });
    expect(await send(orderEvent("order.paid", orderData({ id: "o-4", polarSub: "sub-early", sub })))).toEqual({ kind: "payment", polarOrderId: "o-4" });
    expect(await subRow("sub-early")).toMatchObject({ subscriber_id: a.id, creator_id: b.id });
    expect(await payRow("o-4")).toMatchObject({ creator_cents: 550 });
    // And the subscription message arriving later is the same subscription.
    await send(subEvent("subscription.created", sub));
    expect(await count("select count(*) as n from subscriptions where polar_id = 'sub-early'")).toBe(1);
  });

  it("count renewals and changes, and ignore everything that is not a paid subscription order", async () => {
    await started();
    await send(orderEvent("order.paid", orderData({ id: "o-5", reason: "subscription_cycle" })));
    expect(await payRow("o-5")).not.toBeNull();
    const skipped: [string, ReturnType<typeof orderData>][] = [
      ["pending", orderData({ id: "o-6", status: "pending" })],
      ["draft", orderData({ id: "o-7", status: "draft" })],
      ["void", orderData({ id: "o-8", status: "void" })],
      ["one-off purchase", orderData({ id: "o-9", reason: "purchase" })],
      ["no subscription", orderData({ id: "o-10", polarSub: null })],
      ["other money", orderData({ id: "o-11", currency: "eur" })],
      ["unknown subscription", orderData({ id: "o-12", polarSub: "sub-nobody" })],
    ];
    for (const [label, data] of skipped) {
      expect((await send(orderEvent("order.paid", data))).kind, label).toBe("ignored");
      expect(await payRow(data.id), label).toBeNull();
    }
  });

  it("never lets the database hold a share bigger than the payment", async () => {
    const { a, b } = await started();
    await send(orderEvent("order.paid", orderData({ id: "o-13" })), 100);
    expect(await payRow("o-13")).toMatchObject({ creator_cents: 1000 });
    const bad = (cents: number, split: number) =>
      env.DB.prepare(
        "insert into subscription_payments (id, polar_order_id, subscription_id, mode, creator_id, subscriber_id, net_cents, refunded_cents, split_percent, creator_cents, paid_at, polar_modified_at) select ?, ?, id, 'sandbox', ?, ?, 100, 0, ?, ?, 1, 1 from subscriptions limit 1",
      ).bind(newId("subscriptionPayment"), `bad-${cents}-${split}`, b.id, a.id, split, cents).run();
    await expect(bad(101, 100)).rejects.toThrow();
    await expect(bad(-1, 50)).rejects.toThrow();
    await expect(bad(50, 101)).rejects.toThrow();
  });
});

describe("the alert when someone subscribes", () => {
  const alertsFor = async (userId: string) => (await listAlerts(db(), userId)).items.filter((a) => a.type === "subscribe");

  it("tells the creator once, the first time the subscription is paid up", async () => {
    const a = await person();
    const b = await person();
    const ids = { sub: a.id, creator: b.id };
    await send(subEvent("subscription.created", subData({ ...ids, modified: T0 })));
    const first = await alertsFor(b.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "subscribe", unread: true, count: 1, post: null });
    expect(first[0]?.actors[0]?.userId).toBe(a.id);
    expect(await countUnreadAlerts(db(), b.id)).toBe(1);

    // The same message again, a renewal, a cancel and a late older message all leave it at one alert.
    await send(subEvent("subscription.created", subData({ ...ids, modified: T0 })));
    await send(subEvent("subscription.cycled", subData({ ...ids, modified: T0 + 1000 })));
    await send(subEvent("subscription.canceled", subData({ ...ids, cancel: true, modified: T0 + 2000 })));
    await send(subEvent("subscription.updated", subData({ ...ids, modified: T0 - 5000 })));
    expect(await alertsFor(b.id)).toHaveLength(1);
    expect(await count("select count(*) as n from notifications where type = 'subscribe' and recipient_id = ?", b.id)).toBe(1);
    // The subscriber is not alerted about themselves.
    expect(await alertsFor(a.id)).toHaveLength(0);
  });

  it("waits until the payment has gone through", async () => {
    const a = await person();
    const b = await person();
    const ids = { sub: a.id, creator: b.id };
    await send(subEvent("subscription.created", subData({ ...ids, status: "incomplete", modified: T0 })));
    expect(await alertsFor(b.id)).toHaveLength(0);
    await send(subEvent("subscription.updated", subData({ ...ids, status: "incomplete_expired", modified: T0 + 1000 })));
    expect(await alertsFor(b.id)).toHaveLength(0);
    // A subscription that was never paid for never alerts, and one that later becomes active alerts then.
    const c = await person();
    await send(subEvent("subscription.created", subData({ polar: "sub-late", sub: c.id, creator: b.id, status: "incomplete", modified: T0 })));
    await send(subEvent("subscription.active", subData({ polar: "sub-late", sub: c.id, creator: b.id, status: "active", modified: T0 + 1000 })));
    const alerts = await alertsFor(b.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.actors[0]?.userId).toBe(c.id);
  });

  it("also fires when the first news is a paid order that carries its subscription", async () => {
    const a = await person();
    const b = await person();
    await send(orderEvent("order.paid", orderData({ id: "o-alert", polarSub: "sub-from-order", sub: subData({ polar: "sub-from-order", sub: a.id, creator: b.id }) })));
    expect(await alertsFor(b.id)).toHaveLength(1);
  });

  it("is brought back to the top and made unread when the same person subscribes again later", async () => {
    const a = await person();
    const b = await person();
    await send(subEvent("subscription.created", subData({ polar: "sub-first", sub: a.id, creator: b.id, modified: T0 })));
    await env.DB.prepare("update notifications set read_at = 1, created_at = 1 where recipient_id = ? and type = 'subscribe'").bind(b.id).run();
    expect(await countUnreadAlerts(db(), b.id)).toBe(0);
    await send(subEvent("subscription.revoked", subData({ polar: "sub-first", sub: a.id, creator: b.id, status: "canceled", modified: T0 + 1000 })));
    await send(subEvent("subscription.created", subData({ polar: "sub-second", sub: a.id, creator: b.id, modified: T0 + 2000 })));
    const alerts = await alertsFor(b.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.unread).toBe(true);
    expect(alerts[0]!.createdAt).toBeGreaterThan(1000);
  });

  it("is not shown to someone who blocked the subscriber, and goes with an account that is removed", async () => {
    const a = await person();
    const b = await person();
    await send(subEvent("subscription.created", subData({ sub: a.id, creator: b.id })));
    await setBlock(db(), b.id, a.id, true);
    expect(await alertsFor(b.id)).toHaveLength(0);
    await env.DB.prepare("delete from user where id = ?").bind(a.id).run();
    expect(await count("select count(*) as n from notifications where type = 'subscribe' and recipient_id = ?", b.id)).toBe(0);
  });

  it("is checked by the database: a subscribe alert never points at a post, and never at yourself", async () => {
    const a = await person();
    const b = await person();
    const put = (recipient: string, actor: string, post: string | null) =>
      env.DB.prepare("insert into notifications (id, recipient_id, actor_id, type, post_id) values (?, ?, ?, 'subscribe', ?)").bind(newId("notification"), recipient, actor, post).run();
    await expect(put(a.id, a.id, null)).rejects.toThrow();
    await expect(put(b.id, a.id, "post_000000000000000000000000")).rejects.toThrow();
    await put(b.id, a.id, null);
  });
});

describe("who has access", () => {
  it("is a live subscription in the mode the site is in, and not a test one on a live site", async () => {
    await turnOn("production");
    const a = await person();
    const b = await person();
    await send(subEvent("subscription.created", subData({ sub: a.id, creator: b.id })), 55, "sandbox");
    expect(await hasSubscriberAccess(db(), a.id, b.id, T0)).toBe(false);
    await send(subEvent("subscription.created", subData({ polar: "sub-live", sub: a.id, creator: b.id })), 55, "production");
    expect(await hasSubscriberAccess(db(), a.id, b.id, T0)).toBe(true);
    expect(await hasSubscriberAccess(db(), b.id, a.id, T0)).toBe(false);
  });

  it("lasts to the end of the period after the subscriber stops, then a little grace, then ends", async () => {
    await turnOn();
    const a = await person();
    const b = await person();
    const end = T0 + 30 * 86_400_000;
    await send(subEvent("subscription.canceled", subData({ sub: a.id, creator: b.id, cancel: true, end })));
    expect(await hasSubscriberAccess(db(), a.id, b.id, end - 1000)).toBe(true);
    expect(await hasSubscriberAccess(db(), a.id, b.id, end + ACCESS_GRACE_MS - 1000)).toBe(true);
    // If Polar's message that it ended never reached us, access still stops by itself.
    expect(await hasSubscriberAccess(db(), a.id, b.id, end + ACCESS_GRACE_MS + 1000)).toBe(false);
  });

  it("is not given for a payment that failed, is overdue or was never completed", async () => {
    await turnOn();
    const a = await person();
    const b = await person();
    for (const status of ["incomplete", "incomplete_expired", "past_due", "unpaid", "paused", "canceled"]) {
      await send(subEvent("subscription.updated", subData({ sub: a.id, creator: b.id, status, modified: T0 + (seq += 1000) })));
      expect(await hasSubscriberAccess(db(), a.id, b.id, T0), status).toBe(false);
    }
    await send(subEvent("subscription.updated", subData({ sub: a.id, creator: b.id, status: "trialing", modified: T0 + (seq += 1000) })));
    expect(await hasSubscriberAccess(db(), a.id, b.id, T0)).toBe(true);
  });
});

describe("a member's price", () => {
  it("is set in dollars, kept in cents, and cleared", async () => {
    const m = await person();
    expect(await setSubscriptionPrice(db(), m.id, "5.50")).toEqual({ ok: true, priceCents: 550 });
    expect((await mySubscriptionSettings(db(), m.id)).priceCents).toBe(550);
    for (const bad of ["0.99", "100.01", "abc", "", null, "5.555"]) expect(await setSubscriptionPrice(db(), m.id, bad)).toMatchObject({ ok: false });
    expect((await mySubscriptionSettings(db(), m.id)).priceCents).toBe(550);
    expect(await clearSubscriptionPrice(db(), m.id)).toEqual({ ok: true, priceCents: null });
    expect((await mySubscriptionSettings(db(), m.id)).priceCents).toBeNull();
  });

  it("is checked by the database too", async () => {
    const m = await person();
    const put = (cents: number) => env.DB.prepare("update profiles set subscription_price_cents = ? where user_id = ?").bind(cents, m.id).run();
    await expect(put(99)).rejects.toThrow();
    await expect(put(10_001)).rejects.toThrow();
    await put(100);
    await put(10_000);
  });

  it("is counted as a number of subscribers, never names", async () => {
    await turnOn();
    const creator = await person();
    const [x, y] = [await person(), await person()];
    await send(subEvent("subscription.created", subData({ polar: "s-x", sub: x.id, creator: creator.id })));
    await send(subEvent("subscription.created", subData({ polar: "s-y", sub: y.id, creator: creator.id })));
    await send(subEvent("subscription.revoked", subData({ polar: "s-y", sub: y.id, creator: creator.id, status: "canceled", modified: T0 + 9000 })));
    const mine = await mySubscriptionSettings(db(), creator.id);
    expect(mine).toMatchObject({ enabled: true, testMode: true, creatorPercent: 55, subscribers: 1 });
    expect(Object.keys(mine)).not.toContain("subscribersList");
  });
});

describe("what a profile shows", () => {
  it("offers a subscription only while the owner has them on, and never to yourself", async () => {
    const creator = await person();
    const viewer = await person();
    await setSubscriptionPrice(db(), creator.id, "5");
    expect((await subscribeState(db(), viewer.id, creator.id)).offerCents).toBeNull(); // owner has it off
    await turnOn();
    expect(await subscribeState(db(), viewer.id, creator.id)).toEqual({ offerCents: 500, mine: null, testMode: true });
    expect((await subscribeState(db(), creator.id, creator.id)).offerCents).toBeNull();
    await clearSubscriptionPrice(db(), creator.id);
    expect((await subscribeState(db(), viewer.id, creator.id)).offerCents).toBeNull();
  });

  it("shows a subscription you have, with no offer to subscribe again", async () => {
    await turnOn();
    const creator = await person();
    const viewer = await person();
    await setSubscriptionPrice(db(), creator.id, "5");
    await send(subEvent("subscription.created", subData({ sub: viewer.id, creator: creator.id, cancel: true, end: Date.now() + 5 * 86_400_000 })));
    const state = await subscribeState(db(), viewer.id, creator.id);
    expect(state.offerCents).toBeNull();
    expect(state.mine).toMatchObject({ cancelAtPeriodEnd: true });
    expect((await listMySubscriptions(db(), viewer.id)).map((s) => s.creator.userId)).toEqual([creator.id]);
    expect(await listMySubscriptions(db(), creator.id)).toEqual([]);
  });

  it("hides the offer for someone still waiting for approval", async () => {
    await turnOn();
    const creator = await person({ status: "pending" });
    const viewer = await person();
    await env.DB.prepare("update profiles set subscription_price_cents = 500 where user_id = ?").bind(creator.id).run();
    expect((await subscribeState(db(), viewer.id, creator.id)).offerCents).toBeNull();
  });
});

// ---- Polar's side of subscribing and stopping, with fetch faked but every request built as a real Request ----

type Call = { method: string; url: string; body: Record<string, unknown> | null; auth: string | null };

function fakePolar(handlers: { product?: () => Response; checkout?: () => Response; patch?: () => Response } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const req = new Request(url, init); // the Workers runtime refuses settings its fetch does not know
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method: req.method, url: String(url), body, auth: req.headers.get("authorization") });
    const path = new URL(String(url)).pathname;
    if (path === "/v1/products/") return (handlers.product ?? (() => Response.json({ id: "prod-uuid-1" }, { status: 201 })))();
    if (path === "/v1/checkouts/") return (handlers.checkout ?? (() => Response.json({ id: "co-1", url: "https://sandbox.polar.sh/checkout/abc" }, { status: 201 })))();
    if (path.startsWith("/v1/subscriptions/")) return (handlers.patch ?? (() => Response.json({}, { status: 200 })))();
    return new Response("{}", { status: 404 });
  });
  return calls;
}

describe("subscribing", () => {
  beforeEach(async () => {
    await turnOn();
  });

  async function pair(price = "5") {
    const creator = await person();
    const viewer = await person();
    await setSubscriptionPrice(db(), creator.id, price);
    return { creator, viewer };
  }
  const go = (viewerId: string, creatorId: unknown) => startCheckout(db(), KEY, { subscriberId: viewerId, creatorId, siteName: "Green Valley", origin: ORIGIN });

  it("makes the member's product once, then a checkout filled in with the subscriber's own name and email and carrying our ids", async () => {
    const { creator, viewer } = await pair("5.50");
    const calls = fakePolar();
    expect(await go(viewer.id, creator.id)).toEqual({ ok: true, url: "https://sandbox.polar.sh/checkout/abc" });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v1/products/", "POST /v1/checkouts/"]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}` && c.url.startsWith("https://sandbox-api.polar.sh/"))).toBe(true);
    expect(calls[0]?.body).toMatchObject({
      name: `Subscription to @${creator.username}`,
      recurring_interval: "month",
      visibility: "private",
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 550, tax_behavior: "exclusive" }],
    });
    expect(calls[1]?.body).toMatchObject({
      products: ["prod-uuid-1"],
      external_customer_id: viewer.id,
      metadata: { netmate_creator: creator.id, netmate_subscriber: viewer.id },
      success_url: `${ORIGIN}/subscribe/done?creator=${creator.username}&checkout_id={CHECKOUT_ID}`,
      return_url: `${ORIGIN}/${creator.username}`,
    });
    // Polar's page opens filled in with the subscriber's own details, so they can check them and change them there.
    expect(calls[1]?.body).toMatchObject({ customer_name: expect.stringMatching(/^Sub\d+ Person$/), customer_email: expect.stringMatching(/^sb\d+@example\.com$/) });
    expect(calls[1]?.body?.customer_email).toBe((await env.DB.prepare("select email from user where id = ?").bind(viewer.id).first<{ email: string }>())?.email);
    // Nothing about the creator beyond their id goes to Polar, and nothing is sent when making the product.
    const creatorEmail = (await env.DB.prepare("select email from user where id = ?").bind(creator.id).first<{ email: string }>())?.email;
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain(creatorEmail);
    expect(JSON.stringify(calls[0]?.body)).not.toContain("customer");
    expect(JSON.stringify(calls[0]?.body)).not.toContain(viewer.id);

    // A second subscriber reuses the product.
    const other = await person();
    calls.length = 0;
    await go(other.id, creator.id);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/checkouts/"]);
    expect(await count("select count(*) as n from polar_products")).toBe(1);

    // A new price needs a new product; the old one stays for the people who have it.
    await setSubscriptionPrice(db(), creator.id, "8");
    calls.length = 0;
    await go(other.id, creator.id);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/products/", "/v1/checkouts/"]);
    expect(await count("select count(*) as n from polar_products")).toBe(2);
  });

  it("uses the live address in live mode", async () => {
    await turnOn("production");
    const { creator, viewer } = await pair();
    const calls = fakePolar();
    await go(viewer.id, creator.id);
    expect(calls.every((c) => c.url.startsWith("https://api.polar.sh/"))).toBe(true);
  });

  it("refuses when it should, and says so in plain words without calling Polar", async () => {
    const { creator, viewer } = await pair();
    const calls = fakePolar();
    const fail = async (who: string, to: unknown, text: string) => expect(await go(who, to), text).toEqual({ ok: false, message: expect.stringContaining(text) });

    await fail(creator.id, creator.id, "not available"); // yourself
    await fail(viewer.id, "nope", "not available");
    await fail(viewer.id, "usr_doesnotexist000000000000", "does not offer");
    const free = await person();
    await fail(viewer.id, free.id, "does not offer"); // no price
    const pending = await person({ status: "pending" });
    await env.DB.prepare("update profiles set subscription_price_cents = 500 where user_id = ?").bind(pending.id).run();
    await fail(viewer.id, pending.id, "does not offer");

    await setBlock(db(), viewer.id, creator.id, true);
    await fail(viewer.id, creator.id, "not available");
    await setBlock(db(), viewer.id, creator.id, false);
    await setBlock(db(), creator.id, viewer.id, true);
    await fail(viewer.id, creator.id, "not available");
    await setBlock(db(), creator.id, viewer.id, false);

    await setPaymentsEnabled(db(), KEY, false);
    await fail(viewer.id, creator.id, "not turned on");
    await setPaymentsEnabled(db(), KEY, true);
    expect(calls).toHaveLength(0);
  });

  it("refuses to subscribe twice, and when the keys are gone", async () => {
    const { creator, viewer } = await pair();
    fakePolar();
    await send(subEvent("subscription.created", subData({ sub: viewer.id, creator: creator.id, end: Date.now() + 86_400_000 })));
    expect(await go(viewer.id, creator.id)).toEqual({ ok: false, message: "You are already subscribed." });
    const other = await person();
    await removePaymentKeys(db());
    expect(await go(other.id, creator.id)).toMatchObject({ ok: false });
  });

  it("explains what Polar refused, and only ever sends the member to Polar's own pages", async () => {
    const { creator, viewer } = await pair();
    fakePolar({ product: () => Response.json({ detail: "Missing scope products:write" }, { status: 403 }) });
    expect(await go(viewer.id, creator.id)).toMatchObject({ ok: false, message: expect.stringContaining("missing a permission") });

    fakePolar({ checkout: () => Response.json({ id: "co", url: "https://evil.example/phish" }, { status: 201 }) });
    expect(await go(viewer.id, creator.id)).toEqual({ ok: false, message: "Polar sent back something we could not use." });
    fakePolar({ checkout: () => Response.json({ nothing: true }, { status: 201 }) });
    expect(await go(viewer.id, creator.id)).toMatchObject({ ok: false });
    fakePolar({ checkout: () => Response.json({ detail: "Nope" }, { status: 422 }) });
    expect(await go(viewer.id, creator.id)).toMatchObject({ ok: false, message: expect.stringContaining("422") });
  });

  it("knows Polar's addresses from lookalikes", () => {
    for (const ok of ["https://polar.sh/checkout/x", "https://sandbox.polar.sh/checkout/x", "https://buy.polar.sh/abc"]) expect(isPolarUrl(ok), ok).toBe(true);
    for (const bad of ["http://polar.sh/x", "https://polar.sh.evil.example/x", "https://evilpolar.sh/x", "https://example.com/polar.sh", "javascript:alert(1)", "polar.sh", "", null, 5]) {
      expect(isPolarUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe("stopping", () => {
  beforeEach(async () => {
    await turnOn();
  });

  async function subscribed() {
    const creator = await person();
    const viewer = await person();
    await send(subEvent("subscription.created", subData({ sub: viewer.id, creator: creator.id, end: Date.now() + 10 * 86_400_000 })));
    const id = (await subRow())!.id as string;
    return { creator, viewer, id };
  }

  it("tells Polar to stop at the end of the period, and can start again, sending the state wanted", async () => {
    const { viewer, id } = await subscribed();
    const calls = fakePolar();
    expect(await setAutoRenew(db(), KEY, viewer.id, id, false)).toEqual({ ok: true, cancelAtPeriodEnd: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { cancel_at_period_end: true } });
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/subscriptions/sub-1");
    expect(await subRow()).toMatchObject({ cancel_at_period_end: 1, status: "active" });

    // Asking again for what is already so does nothing at Polar.
    expect(await setAutoRenew(db(), KEY, viewer.id, id, false)).toEqual({ ok: true, cancelAtPeriodEnd: true });
    expect(calls).toHaveLength(1);

    expect(await setAutoRenew(db(), KEY, viewer.id, id, true)).toEqual({ ok: true, cancelAtPeriodEnd: false });
    expect(calls[1]?.body).toEqual({ cancel_at_period_end: false });
    expect(await subRow()).toMatchObject({ cancel_at_period_end: 0 });
  });

  it("is only for the subscriber, and leaves the row alone when Polar refuses", async () => {
    const { creator, viewer, id } = await subscribed();
    const calls = fakePolar();
    expect(await setAutoRenew(db(), KEY, creator.id, id, false)).toMatchObject({ ok: false });
    expect(await setAutoRenew(db(), KEY, (await person()).id, id, false)).toMatchObject({ ok: false });
    expect(await setAutoRenew(db(), KEY, viewer.id, "sub_notarealidxxxxxxxxxxxxxxx", false)).toMatchObject({ ok: false });
    expect(await setAutoRenew(db(), KEY, viewer.id, id, "yes")).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);

    fakePolar({ patch: () => Response.json({ detail: "Subscription is locked" }, { status: 409 }) });
    expect(await setAutoRenew(db(), KEY, viewer.id, id, false)).toMatchObject({ ok: false, message: expect.stringContaining("409") });
    expect(await subRow()).toMatchObject({ cancel_at_period_end: 0 });
  });
});

describe("the webhook address", () => {
  const enc = new TextEncoder();
  const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  async function signed(body: string, id = "msg_1", at = Date.now(), secret = SECRET) {
    const ts = String(Math.floor(at / 1000));
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = b64(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
    return new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` });
  }

  it("does not exist until the keys are saved", async () => {
    const body = "{}";
    expect(await processPolarWebhook(db(), KEY, body, await signed(body))).toEqual({ status: 404, body: {} });
  });

  it("refuses anything Polar did not sign, and never touches the data", async () => {
    await turnOn();
    const a = await person();
    const b = await person();
    const body = JSON.stringify(subEvent("subscription.created", subData({ sub: a.id, creator: b.id })));
    expect((await processPolarWebhook(db(), KEY, body, new Headers())).status).toBe(401);
    expect((await processPolarWebhook(db(), KEY, body, await signed(body, "m", Date.now(), `${SECRET}x`))).status).toBe(401);
    expect((await processPolarWebhook(db(), KEY, body, await signed(body, "m", Date.now() - 10 * 60_000))).status).toBe(401);
    expect((await processPolarWebhook(db(), KEY, `${body} `, await signed(body))).status).toBe(401);
    expect(await count("select count(*) as n from subscriptions")).toBe(0);
  });

  it("takes a signed message, once or many times, and answers plainly to the rest", async () => {
    await turnOn();
    const a = await person();
    const b = await person();
    const body = JSON.stringify(subEvent("subscription.created", subData({ sub: a.id, creator: b.id })));
    for (let i = 0; i < 2; i++) expect(await processPolarWebhook(db(), KEY, body, await signed(body))).toEqual({ status: 200, body: { ok: true, handled: true } });
    expect(await count("select count(*) as n from subscriptions")).toBe(1);

    const other = JSON.stringify({ type: "customer.created", data: {} });
    expect(await processPolarWebhook(db(), KEY, other, await signed(other))).toEqual({ status: 200, body: { ok: true, handled: false } });
    expect((await processPolarWebhook(db(), KEY, "not json", await signed("not json"))).status).toBe(400);
    const big = "x".repeat(600 * 1024);
    expect((await processPolarWebhook(db(), KEY, big, await signed(big))).status).toBe(413);
  });

  it("reads the same headers the tests sign with", () => {
    expect(readWebhookHeaders(new Headers({ "webhook-id": "a" })).id).toBe("a");
  });
});
