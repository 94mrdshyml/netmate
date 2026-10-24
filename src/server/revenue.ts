// The money pages (docs/PRD.md, "Paid subscriptions"): the owner's whole picture and each member's own earnings. Every
// number comes from the payment rows that Polar's signed messages made (src/server/polar-events.ts) and from the
// payouts the owner records by hand. Only the mode the site is in now is counted, so practice (sandbox) money never mixes
// with live money. The owner sees every member's earnings; a member sees only their own, with the names of their
// subscribers and what each has brought in (the owner's decision, session 54).

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { payouts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { formatUsd, parseDollars } from "@/lib/money";
import { ledger, lastMonths, type Ledger, type Sums } from "@/lib/revenue";
import { readPaymentSettings } from "@/server/payments";
import type { PolarMode } from "@/payments/polar";

export const MONTHS = 12;
export const PAYOUT_MAX_CENTS = 100_000_000;
export const PAYOUT_NOTE_MAX = 200;

type SumRow = { total: number; tax: number; refunded: number; refundedTax: number; fee: number; earned: number; n: number };

const toSums = (r: SumRow | undefined, paid = 0): Sums => ({
  totalCents: r?.total ?? 0,
  taxCents: r?.tax ?? 0,
  refundedCents: r?.refunded ?? 0,
  refundedTaxCents: r?.refundedTax ?? 0,
  feeCents: r?.fee ?? 0,
  earnedCents: r?.earned ?? 0,
  paidOutCents: paid,
});

const SUMS = sql`coalesce(sum(total_cents), 0) as total, coalesce(sum(tax_cents), 0) as tax, coalesce(sum(refunded_cents), 0) as refunded,
  coalesce(sum(refunded_tax_cents), 0) as refundedTax, coalesce(sum(fee_cents), 0) as fee, coalesce(sum(creator_cents), 0) as earned, count(*) as n`;

/** The first moment of the oldest month shown, in milliseconds. */
const windowStart = (now: number) => {
  const [y, m] = lastMonths(now, MONTHS)[0]!.split("-").map(Number) as [number, number];
  return Date.UTC(y, m - 1, 1);
};

export type MonthPoint = { key: string; ledger: Ledger; payments: number };

async function monthly(db: Db, mode: PolarMode, now: number, creatorId: string | null): Promise<MonthPoint[]> {
  const who = creatorId === null ? sql`` : sql`and creator_id = ${creatorId}`;
  const rows = await db.all<SumRow & { month: string }>(sql`
    select strftime('%Y-%m', paid_at / 1000, 'unixepoch') as month, ${SUMS}
    from subscription_payments where mode = ${mode} and paid_at >= ${windowStart(now)} ${who} group by month`);
  const by = new Map(rows.map((r) => [r.month, r]));
  return lastMonths(now, MONTHS).map((key) => ({ key, ledger: ledger(toSums(by.get(key))), payments: by.get(key)?.n ?? 0 }));
}

// ---- the owner ----

export type MemberMoney = {
  userId: string;
  username: string;
  name: string;
  subscribers: number;
  payments: number;
  earned: number;
  paid: number;
  stillToPay: number;
};

export type PayoutRow = { id: string; userId: string; name: string; username: string; amountCents: number; note: string; at: number; voided: boolean };

export type OwnerRevenue = {
  mode: PolarMode;
  totals: Ledger;
  payments: number;
  months: MonthPoint[];
  members: MemberMoney[];
  payouts: PayoutRow[];
};

/** Everything on /hq/revenue. */
export async function ownerRevenue(db: Db, now: number = Date.now()): Promise<OwnerRevenue> {
  const { mode } = await readPaymentSettings(db);
  const [sums] = await db.all<SumRow>(sql`select ${SUMS} from subscription_payments where mode = ${mode}`);
  const [paid] = await db.all<{ n: number }>(sql`select coalesce(sum(amount_cents), 0) as n from payouts where mode = ${mode} and voided_at is null`);

  const members = await db.all<{ userId: string; username: string; first: string; last: string; earned: number; payments: number; paid: number; subscribers: number }>(sql`
    select s.creator_id as userId, p.username as username, p.first_name as first, p.last_name as last,
           coalesce(sum(s.creator_cents), 0) as earned, count(*) as payments,
           (select coalesce(sum(y.amount_cents), 0) from payouts y where y.creator_id = s.creator_id and y.mode = ${mode} and y.voided_at is null) as paid,
           (select count(distinct b.subscriber_id) from subscriptions b where b.creator_id = s.creator_id and b.mode = ${mode} and b.status in ('active', 'trialing')) as subscribers
    from subscription_payments s join profiles p on p.user_id = s.creator_id
    where s.mode = ${mode} group by s.creator_id order by earned desc, p.username limit 200`);

  const recent = await db.all<{ id: string; userId: string; first: string; last: string; username: string; amount: number; note: string; at: number; voided: number | null }>(sql`
    select y.id as id, y.creator_id as userId, p.first_name as first, p.last_name as last, p.username as username,
           y.amount_cents as amount, y.note as note, y.created_at as at, y.voided_at as voided
    from payouts y join profiles p on p.user_id = y.creator_id
    where y.mode = ${mode} order by y.created_at desc, y.id desc limit 30`);

  return {
    mode,
    totals: ledger(toSums(sums, paid?.n ?? 0)),
    payments: sums?.n ?? 0,
    months: await monthly(db, mode, now, null),
    members: members.map((m) => ({
      userId: m.userId,
      username: m.username,
      name: `${m.first} ${m.last}`,
      subscribers: m.subscribers,
      payments: m.payments,
      earned: m.earned,
      paid: m.paid,
      stillToPay: m.earned - m.paid,
    })),
    payouts: recent.map((r) => ({ id: r.id, userId: r.userId, name: `${r.first} ${r.last}`, username: r.username, amountCents: r.amount, note: r.note, at: r.at, voided: r.voided !== null })),
  };
}

// ---- one member ----

export type SubscriberRow = {
  userId: string;
  username: string;
  name: string;
  since: number;
  /** Subscribed now (paid up), whether or not it renews. */
  live: boolean;
  stopsAtPeriodEnd: boolean;
  periodEnd: number | null;
  priceCents: number;
  /** What this person's payments have earned the member. */
  earnedFromThem: number;
};

export type MemberEarnings = {
  mode: PolarMode;
  earned: number;
  paid: number;
  stillToPay: number;
  thisMonth: number;
  months: { key: string; earned: number; payments: number }[];
  subscribers: SubscriberRow[];
  payouts: { id: string; amountCents: number; note: string; at: number }[];
};

/** A member's own earnings, the people who subscribe to them and what each has brought in, and what they have been paid. */
export async function memberEarnings(db: Db, userId: string, now: number = Date.now()): Promise<MemberEarnings> {
  const { mode } = await readPaymentSettings(db);
  const [sums] = await db.all<SumRow>(sql`select ${SUMS} from subscription_payments where mode = ${mode} and creator_id = ${userId}`);
  const [paid] = await db.all<{ n: number }>(sql`select coalesce(sum(amount_cents), 0) as n from payouts where mode = ${mode} and creator_id = ${userId} and voided_at is null`);
  const months = (await monthly(db, mode, now, userId)).map((m) => ({ key: m.key, earned: m.ledger.memberEarned, payments: m.payments }));

  const people = await db.all<{ userId: string; username: string; first: string; last: string; since: number; status: string; cancel: number; end: number | null; price: number; earned: number }>(sql`
    select b.subscriber_id as userId, p.username as username, p.first_name as first, p.last_name as last, b.created_at as since,
           b.status as status, b.cancel_at_period_end as cancel, b.current_period_end as end, b.price_cents as price,
           (select coalesce(sum(s.creator_cents), 0) from subscription_payments s where s.subscription_id = b.id) as earned
    from subscriptions b join profiles p on p.user_id = b.subscriber_id
    where b.creator_id = ${userId} and b.mode = ${mode}
      and (b.status in ('active', 'trialing', 'past_due', 'canceled') )
    order by (b.status in ('active', 'trialing')) desc, b.created_at desc limit 200`);

  const mine = await db
    .select({ id: payouts.id, amountCents: payouts.amountCents, note: payouts.note, at: payouts.createdAt })
    .from(payouts)
    .where(and(eq(payouts.creatorId, userId), eq(payouts.mode, mode), sql`${payouts.voidedAt} is null`))
    .orderBy(sql`${payouts.createdAt} desc`)
    .limit(30);

  const earned = sums?.earned ?? 0;
  return {
    mode,
    earned,
    paid: paid?.n ?? 0,
    stillToPay: earned - (paid?.n ?? 0),
    thisMonth: months[months.length - 1]?.earned ?? 0,
    months,
    subscribers: people.map((r) => ({
      userId: r.userId,
      username: r.username,
      name: `${r.first} ${r.last}`,
      since: r.since,
      live: r.status === "active" || r.status === "trialing",
      stopsAtPeriodEnd: r.cancel === 1,
      periodEnd: r.end,
      priceCents: r.price,
      earnedFromThem: r.earned,
    })),
    payouts: mine.map((r) => ({ id: r.id, amountCents: r.amountCents, note: r.note, at: r.at.getTime() })),
  };
}

// ---- payouts (the owner records them by hand) ----

export type PayoutResult =
  | { ok: true; id: string }
  | { ok: false; code: "bad_amount" | "bad_note" | "too_much" | "not_found"; message: string };

// Control characters other than newline and tab never belong in a note.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Records that the owner paid a member. The amount can never be more than the member is owed at that moment: the insert
 * itself checks it against what they earned and what was already paid, in one statement, so two payouts recorded at
 * the same moment cannot both take the last of the balance.
 */
export async function recordPayout(db: Db, adminId: string, creatorId: unknown, rawAmount: unknown, rawNote: unknown): Promise<PayoutResult> {
  const amount = parseDollars(rawAmount, 1, PAYOUT_MAX_CENTS);
  if (!amount.ok) return { ok: false, code: "bad_amount", message: amount.message };
  const note = typeof rawNote === "string" ? rawNote.replace(/\r\n?/g, "\n").trim() : "";
  if (CONTROL.test(note) || Array.from(note).length > PAYOUT_NOTE_MAX) return { ok: false, code: "bad_note", message: `Keep the note to ${PAYOUT_NOTE_MAX} characters, plain text.` };
  if (typeof creatorId !== "string") return { ok: false, code: "not_found", message: "That member is not available." };

  const { mode } = await readPaymentSettings(db);
  const [member] = await db.all<{ earned: number; paid: number }>(sql`
    select (select coalesce(sum(creator_cents), 0) from subscription_payments where creator_id = ${creatorId} and mode = ${mode}) as earned,
           (select coalesce(sum(amount_cents), 0) from payouts where creator_id = ${creatorId} and mode = ${mode} and voided_at is null) as paid
    where exists (select 1 from profiles where user_id = ${creatorId})`);
  if (!member) return { ok: false, code: "not_found", message: "That member is not available." };

  const id = newId("payout");
  await db.insert(payouts).select(
    sql`select ${id}, ${creatorId}, ${mode}, ${amount.cents}, ${note}, ${adminId}, ${Date.now()}, null
        where ${amount.cents} <= (select coalesce(sum(creator_cents), 0) from subscription_payments where creator_id = ${creatorId} and mode = ${mode})
                              - (select coalesce(sum(amount_cents), 0) from payouts where creator_id = ${creatorId} and mode = ${mode} and voided_at is null)`,
  );
  const made = await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.id, id)).get();
  if (!made) {
    const owed = Math.max(0, member.earned - member.paid);
    return { ok: false, code: "too_much", message: `That is more than they are owed (${formatUsd(owed)}).` };
  }
  return { ok: true, id };
}

/** Takes back a payout recorded by mistake. It stays on record, marked as voided. Doing it twice changes nothing. */
export async function voidPayout(db: Db, payoutId: unknown): Promise<{ ok: boolean }> {
  if (typeof payoutId !== "string" || !/^pay_[0-9A-Za-z]{24}$/.test(payoutId)) return { ok: false };
  const row = await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.id, payoutId)).get();
  if (!row) return { ok: false };
  await db.update(payouts).set({ voidedAt: new Date() }).where(and(eq(payouts.id, payoutId), sql`${payouts.voidedAt} is null`));
  return { ok: true };
}
