import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { DEFAULT_FEE } from "@/lib/money";
import { monthKey } from "@/lib/revenue";
import { removePaymentKeys, savePaymentConnection, savePaymentSplit } from "@/server/payments";
import { handlePolarEvent, type Terms } from "@/server/polar-events";
import { memberEarnings, ownerRevenue, recordPayout, voidPayout } from "@/server/revenue";

const db = () => getDb(env.DB);
const KEY = "k".repeat(40);
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

let n = 0;
async function person(first?: string) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `rv${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `rev_${i}`, firstName: first ?? `Rev${i}`, lastName: "Person" });
  return { id, username: `rev_${i}` };
}
const admin = async () => (await person("Boss")).id;

afterEach(async () => {
  await removePaymentKeys(db());
  for (const t of ["payouts", "subscription_payments", "subscriptions", "payment_settings"]) await env.DB.prepare(`delete from ${t}`).run();
});

// ---- Polar messages (field names from Polar's API description) ----

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0); // 24 Oct 2026
let seq = 0;

const sub = (polar: string, subscriber: string, creator: string, over: Record<string, unknown> = {}) => ({
  id: polar,
  created_at: iso(NOW - 40 * 86_400_000),
  modified_at: iso(NOW - 86_400_000 + ++seq),
  amount: 1000,
  currency: "usd",
  status: "active",
  current_period_end: iso(NOW + 20 * 86_400_000),
  cancel_at_period_end: false,
  metadata: { netmate_subscriber: subscriber, netmate_creator: creator },
  ...over,
});

/** A paid order for a $10.00 price that includes tax: `tax` of it is tax, so the net is the rest. */
function order(id: string, polarSub: string, o: { at?: number; tax?: number; refundedNet?: number; refundedTax?: number; total?: number; status?: string; modified?: number } = {}) {
  const total = o.total ?? 1000;
  const tax = o.tax ?? 150;
  return {
    id,
    created_at: iso(o.at ?? NOW - 3600_000),
    modified_at: iso(o.modified ?? o.at ?? NOW - 3600_000),
    status: o.status ?? "paid",
    net_amount: total - tax,
    total_amount: total,
    tax_amount: tax,
    refunded_amount: o.refundedNet ?? 0,
    refunded_tax_amount: o.refundedTax ?? 0,
    currency: "usd",
    billing_reason: "subscription_create",
    subscription_id: polarSub,
    metadata: {},
  };
}

const TERMS: Terms = { splitPercent: 55, ...DEFAULT_FEE };
const ALL: Terms = { splitPercent: 100, ...DEFAULT_FEE };
const sendOrder = (data: ReturnType<typeof order>, subscription: ReturnType<typeof sub>, terms = TERMS, mode: "sandbox" | "production" = "sandbox") =>
  handlePolarEvent(db(), mode, { type: "order.paid", data: { ...data, subscription } }, terms);

async function setup(split = 55) {
  await savePaymentConnection(db(), KEY, { mode: "sandbox" });
  await savePaymentSplit(db(), String(split));
}

describe("the owner's money picture", () => {
  it("works out what reaches the owner and what is left, from a payment with tax", async () => {
    await setup();
    const [a, c] = [await person(), await person()];
    // $10.00 including $1.50 tax: net $8.50. Fee: 4.50% of 850 = 38 (38.25) + 40 = 78. Member: 55% of 850 = 467.
    await sendOrder(order("o-1", "s-1"), sub("s-1", a.id, c.id));
    const r = await ownerRevenue(db(), NOW);
    expect(r.mode).toBe("sandbox");
    expect(r.payments).toBe(1);
    expect(r.totals).toEqual({ collected: 1000, refunded: 0, tax: 150, polarFee: 78, reachesYou: 772, memberEarned: 467, memberPaid: 0, stillToPay: 467, yoursToKeep: 305 });
  });

  it("takes a part refund off the member's share, keeps the fee and gives back the tax that went back", async () => {
    await setup();
    const [a, c] = [await person(), await person()];
    const s = sub("s-2", a.id, c.id);
    await sendOrder(order("o-2", "s-2", { modified: NOW - 7200_000 }), s);
    // $2.00 of the net and $0.30 of the tax go back.
    await sendOrder(order("o-2", "s-2", { refundedNet: 200, refundedTax: 30, status: "partially_refunded", modified: NOW - 3600_000 }), s);
    const t = (await ownerRevenue(db(), NOW)).totals;
    expect(t).toEqual({ collected: 1000, refunded: 230, tax: 120, polarFee: 78, reachesYou: 572, memberEarned: 357, memberPaid: 0, stillToPay: 357, yoursToKeep: 215 });
    // Every amount is a whole number of cents (a share never ends in half a cent).
    for (const v of Object.values(t)) expect(Number.isInteger(v)).toBe(true);
    const stored = (await env.DB.prepare("select typeof(creator_cents) as t, creator_cents as v from subscription_payments").all<{ t: string; v: number }>()).results;
    expect(stored).toEqual([{ t: "integer", v: 357 }]);
    // The parts always add up to what was collected.
    expect(t.refunded + t.tax + t.polarFee + t.memberEarned + t.yoursToKeep).toBe(t.collected);
  });

  it("keeps the fee a payment was first counted with, even when the owner changes the rate", async () => {
    await setup();
    const [a, c] = [await person(), await person()];
    const s = sub("s-3", a.id, c.id);
    await sendOrder(order("o-3", "s-3"), s);
    await sendOrder(order("o-4", "s-3", { at: NOW - 1800_000 }), s, { splitPercent: 55, feeBp: 1000, feeFixedCents: 0 }); // 10% flat
    const rows = (await env.DB.prepare("select polar_order_id as id, fee_cents as fee from subscription_payments order by polar_order_id").all<{ id: string; fee: number }>()).results;
    expect(rows).toEqual([{ id: "o-3", fee: 78 }, { id: "o-4", fee: 85 }]);
    // A repeated message later, at yet another rate, changes nothing.
    await sendOrder(order("o-3", "s-3"), s, { splitPercent: 10, feeBp: 0, feeFixedCents: 0 });
    expect((await env.DB.prepare("select fee_cents as fee, split_percent as pct from subscription_payments where polar_order_id = 'o-3'").first<{ fee: number; pct: number }>())).toEqual({ fee: 78, pct: 55 });
  });

  it("counts only the mode the site is in, and shows a month at a time with older ones left out of the graph but in the totals", async () => {
    await setup();
    const [a, c] = [await person(), await person()];
    const s = sub("s-4", a.id, c.id);
    await sendOrder(order("o-now", "s-4", { at: NOW - 3600_000 }), s);
    await sendOrder(order("o-sep", "s-4", { at: Date.UTC(2026, 8, 5) }), s);
    await sendOrder(order("o-old", "s-4", { at: Date.UTC(2025, 5, 5) }), s); // 16 months ago
    await sendOrder(order("o-live", "s-live", { at: NOW - 1000 }), sub("s-live", a.id, c.id), TERMS, "production");

    const r = await ownerRevenue(db(), NOW);
    expect(r.payments).toBe(3); // the live one is not counted while the site is in test mode
    expect(r.totals.collected).toBe(3000);
    expect(r.months).toHaveLength(12);
    expect(r.months[11]).toMatchObject({ key: monthKey(NOW), payments: 1 });
    expect(r.months[11]!.ledger.collected).toBe(1000);
    expect(r.months.find((m) => m.key === "2026-09")?.ledger.collected).toBe(1000);
    expect(r.months.reduce((sum, m) => sum + m.ledger.collected, 0)).toBe(2000);
    expect(r.months.map((m) => m.key)).toEqual([...r.months.map((m) => m.key)].sort());
  });

  it("lists each member with what they earned, were paid and are still owed", async () => {
    await setup();
    const [a, b, c1, c2] = [await person("Ann"), await person("Bo"), await person("Cy"), await person("Di")];
    await sendOrder(order("o-a1", "s-a1"), sub("s-a1", a.id, c1.id));
    await sendOrder(order("o-b1", "s-b1"), sub("s-b1", b.id, c1.id));
    await sendOrder(order("o-a2", "s-a2"), sub("s-a2", a.id, c2.id));
    expect((await recordPayout(db(), await admin(), c1.id, "4", "first part")).ok).toBe(true);
    const r = await ownerRevenue(db(), NOW);
    const cy = r.members.find((m) => m.userId === c1.id)!;
    expect(cy).toMatchObject({ name: "Cy Person", subscribers: 2, payments: 2, earned: 934, paid: 400, stillToPay: 534 });
    expect(r.members.find((m) => m.userId === c2.id)).toMatchObject({ earned: 467, paid: 0, stillToPay: 467, subscribers: 1 });
    expect(r.members[0]!.userId).toBe(c1.id); // the biggest earner first
    expect(r.totals).toMatchObject({ memberEarned: 1401, memberPaid: 400, stillToPay: 1001 });
    expect(r.payouts).toHaveLength(1);
    expect(r.payouts[0]).toMatchObject({ amountCents: 400, note: "first part", voided: false, name: "Cy Person" });
  });
});

describe("payouts", () => {
  async function owed(cents = 1000) {
    await setup(100); // 100% so the member earns the net: $8.50 per order
    const [a, c] = [await person(), await person()];
    for (let i = 0; i < Math.ceil(cents / 850); i++) await sendOrder(order(`o-p-${c.id}-${i}`, `s-p-${c.id}-${i}`), sub(`s-p-${c.id}-${i}`, a.id, c.id), ALL);
    return { c, boss: await admin() };
  }

  it("records a payout up to what is owed, and not a cent more", async () => {
    const { c, boss } = await owed(850);
    expect(await recordPayout(db(), boss, c.id, "8.51", "")).toMatchObject({ ok: false, code: "too_much", message: "That is more than they are owed ($8.50)." });
    expect((await recordPayout(db(), boss, c.id, "5", "bank transfer")).ok).toBe(true);
    expect(await recordPayout(db(), boss, c.id, "3.51", "")).toMatchObject({ ok: false, code: "too_much", message: "That is more than they are owed ($3.50)." });
    expect((await recordPayout(db(), boss, c.id, "3.50", "")).ok).toBe(true);
    expect((await memberEarnings(db(), c.id, NOW)).stillToPay).toBe(0);
    expect(await recordPayout(db(), boss, c.id, "0.01", "")).toMatchObject({ ok: false, code: "too_much" });
  });

  it("cannot overspend when two are recorded at the same moment", async () => {
    const { c, boss } = await owed(850);
    const results = await Promise.all(Array.from({ length: 5 }, () => recordPayout(db(), boss, c.id, "8.50", "")));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await count("select count(*) as n from payouts where creator_id = ?", c.id)).toBe(1);
  });

  it("can be voided, which gives the balance back, and voiding twice changes nothing", async () => {
    const { c, boss } = await owed(850);
    const made = await recordPayout(db(), boss, c.id, "8.50", "oops");
    if (!made.ok) throw new Error("not recorded");
    expect((await memberEarnings(db(), c.id, NOW)).stillToPay).toBe(0);
    expect(await voidPayout(db(), made.id)).toEqual({ ok: true });
    expect(await voidPayout(db(), made.id)).toEqual({ ok: true });
    expect((await memberEarnings(db(), c.id, NOW)).stillToPay).toBe(850);
    expect((await memberEarnings(db(), c.id, NOW)).payouts).toHaveLength(0);
    // It stays on the owner's record, marked as voided.
    const r = await ownerRevenue(db(), NOW);
    expect(r.payouts[0]).toMatchObject({ voided: true, note: "oops" });
    expect(r.totals.memberPaid).toBe(0);
    expect((await recordPayout(db(), boss, c.id, "8.50", "again")).ok).toBe(true);
    expect(await voidPayout(db(), "nope")).toEqual({ ok: false });
    expect(await voidPayout(db(), "pay_000000000000000000000000")).toEqual({ ok: false });
  });

  it("refuses bad amounts, bad notes and people who do not exist", async () => {
    const { c, boss } = await owed(850);
    for (const bad of ["", "abc", "-5", "0", "0.001", "1e2", null]) expect(await recordPayout(db(), boss, c.id, bad, ""), String(bad)).toMatchObject({ ok: false, code: "bad_amount" });
    expect(await recordPayout(db(), boss, c.id, "1", "x".repeat(201))).toMatchObject({ ok: false, code: "bad_note" });
    expect(await recordPayout(db(), boss, c.id, "1", "bad\u0000note")).toMatchObject({ ok: false, code: "bad_note" });
    expect(await recordPayout(db(), boss, "usr_doesnotexist000000000000", "1", "")).toMatchObject({ ok: false, code: "not_found" });
    expect(await recordPayout(db(), boss, 5, "1", "")).toMatchObject({ ok: false, code: "not_found" });
    expect(await count("select count(*) as n from payouts")).toBe(0);
  });

  it("is checked by the database too", async () => {
    const { c } = await owed(850);
    const put = (mode: string, cents: number, note = "") => env.DB.prepare("insert into payouts (id, creator_id, mode, amount_cents, note) values (?, ?, ?, ?, ?)").bind(newId("payout"), c.id, mode, cents, note).run();
    await expect(put("staging", 100)).rejects.toThrow();
    await expect(put("sandbox", 0)).rejects.toThrow();
    await expect(put("sandbox", -5)).rejects.toThrow();
    await expect(put("sandbox", 100_000_001)).rejects.toThrow();
    await expect(put("sandbox", 100, "x".repeat(201))).rejects.toThrow();
    await put("sandbox", 100, "x".repeat(200));
  });

  it("does not count test payouts against live money", async () => {
    const { c, boss } = await owed(850);
    await recordPayout(db(), boss, c.id, "8.50", "test money");
    await savePaymentConnection(db(), KEY, { mode: "production" });
    const r = await ownerRevenue(db(), NOW);
    expect(r.mode).toBe("production");
    expect(r.totals).toMatchObject({ collected: 0, memberPaid: 0 });
    expect(r.payouts).toHaveLength(0);
  });
});

describe("a member's own earnings", () => {
  it("shows their subscribers by name with what each brought in, and only their own money", async () => {
    await setup();
    const [ann, bo, creator, other] = [await person("Ann"), await person("Bo"), await person("Cy"), await person("Di")];
    await sendOrder(order("o-m1", "s-m1", { at: NOW - 2 * 86_400_000 }), sub("s-m1", ann.id, creator.id));
    await sendOrder(order("o-m1b", "s-m1", { at: NOW - 1000, modified: NOW - 500 }), sub("s-m1", ann.id, creator.id));
    await sendOrder(order("o-m2", "s-m2"), sub("s-m2", bo.id, creator.id, { status: "canceled", cancel_at_period_end: true }));
    await sendOrder(order("o-other", "s-o"), sub("s-o", ann.id, other.id));

    const e = await memberEarnings(db(), creator.id, NOW);
    expect(e).toMatchObject({ mode: "sandbox", earned: 3 * 467, paid: 0, stillToPay: 3 * 467 });
    expect(e.thisMonth).toBe(3 * 467);
    expect(e.months).toHaveLength(12);
    expect(e.subscribers.map((s) => s.name)).toEqual(["Ann Person", "Bo Person"]); // paid-up first, then ended
    expect(e.subscribers[0]).toMatchObject({ username: ann.username, live: true, stopsAtPeriodEnd: false, priceCents: 1000, earnedFromThem: 934 });
    expect(e.subscribers[1]).toMatchObject({ username: bo.username, live: false, earnedFromThem: 467 });
    // Someone else's money and subscribers never show up here.
    expect(JSON.stringify(e)).not.toContain(other.id);
    expect((await memberEarnings(db(), other.id, NOW)).earned).toBe(467);
    expect((await memberEarnings(db(), (await person()).id, NOW))).toMatchObject({ earned: 0, subscribers: [], payouts: [] });
  });

  it("lists payouts received but never a voided one or anyone else's", async () => {
    await setup(100);
    const [a, c, d] = [await person(), await person(), await person()];
    await sendOrder(order("o-r1", "s-r1"), sub("s-r1", a.id, c.id), ALL);
    await sendOrder(order("o-r2", "s-r2"), sub("s-r2", a.id, d.id), ALL);
    const boss = await admin();
    await recordPayout(db(), boss, c.id, "2", "first");
    const gone = await recordPayout(db(), boss, c.id, "3", "mistake");
    await recordPayout(db(), boss, d.id, "4", "theirs");
    if (gone.ok) await voidPayout(db(), gone.id);
    const e = await memberEarnings(db(), c.id, NOW);
    expect(e.payouts.map((p) => [p.amountCents, p.note])).toEqual([[200, "first"]]);
    expect(e).toMatchObject({ earned: 850, paid: 200, stillToPay: 650 });
  });
});
