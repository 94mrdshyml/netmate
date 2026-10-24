// Turns Polar's webhook messages into our own records (docs/PRD.md, "Paid subscriptions"). The route calls this only
// for a message whose signature checked out. Every step is safe to repeat and safe to receive late: a subscription row
// is replaced only by a message Polar changed more recently, and a payment row is worked out again from the order
// each time, so the answer never depends on the order messages arrive in.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { LIVE_SUBSCRIPTION_STATUSES, profiles, subscriptionPayments, subscriptions } from "@/db/schema";
import { isId, newId } from "@/lib/ids";
import { CURRENCY, creatorShareCents } from "@/lib/money";
import { envelope, ORDER_EVENTS, orderData, PAID_STATUSES, PAYING_REASONS, subscriptionData, SUBSCRIPTION_EVENTS, type PolarSubscription } from "@/payments/events";
import type { PolarMode } from "@/payments/polar";
import { alertOnSubscribe } from "@/server/notifications";

/** The two ids we put on every checkout, which Polar copies onto the subscription. */
export const META_CREATOR = "netmate_creator";
export const META_SUBSCRIBER = "netmate_subscriber";

export type EventOutcome =
  | { kind: "subscription"; polarId: string }
  | { kind: "payment"; polarOrderId: string }
  | { kind: "ignored"; reason: "other_event" | "not_ours" | "not_usd" | "not_paid" | "bad_message" };

const ignored = (reason: Extract<EventOutcome, { kind: "ignored" }>["reason"]): EventOutcome => ({ kind: "ignored", reason });

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Tells the creator, once, the first time the subscription is paid up (active or trialing). Marking it and alerting are
 * one batch, and the alert is written only if the mark really changed the row, so repeats and late messages alert nobody twice.
 */
async function announce(db: Db, polarId: string): Promise<void> {
  const at = Date.now();
  await db.batch([
    db
      .update(subscriptions)
      .set({ notifiedAt: new Date(at) })
      .where(and(eq(subscriptions.polarId, polarId), isNull(subscriptions.notifiedAt), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]))),
    alertOnSubscribe(db, polarId, at),
  ]);
}

/** Makes or updates our row for a Polar subscription. False when it is not one of ours (no ids of ours on it). */
async function saveSubscription(db: Db, mode: PolarMode, sub: PolarSubscription): Promise<boolean> {
  const modified = sub.modified_at ?? sub.created_at;
  const known = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.polarId, sub.id)).get();

  if (sub.currency.toLowerCase() !== CURRENCY) return false;

  const set = {
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    priceCents: sub.amount,
    currentPeriodEnd: sub.current_period_end === null ? null : new Date(sub.current_period_end),
    polarModifiedAt: modified,
    updatedAt: new Date(),
  };
  // Only the ids on the first message count; later ones update the state of the row that is already there.
  if (known) {
    await db.update(subscriptions).set(set).where(sql`${subscriptions.polarId} = ${sub.id} and ${subscriptions.polarModifiedAt} <= ${modified}`);
    await announce(db, sub.id);
    return true;
  }

  const subscriberId = text(sub.metadata[META_SUBSCRIBER]);
  const creatorId = text(sub.metadata[META_CREATOR]);
  if (!isId("user", subscriberId) || !isId("user", creatorId) || subscriberId === creatorId) return false;
  const people = await db.select({ id: profiles.userId }).from(profiles).where(sql`${profiles.userId} in (${subscriberId}, ${creatorId})`);
  if (people.length !== 2) return false;

  await db
    .insert(subscriptions)
    .values({ id: newId("subscription"), polarId: sub.id, mode, subscriberId, creatorId, createdAt: new Date(sub.created_at), ...set })
    .onConflictDoUpdate({ target: subscriptions.polarId, set, setWhere: sql`${subscriptions.polarModifiedAt} <= ${modified}` });
  await announce(db, sub.id);
  return true;
}

/**
 * Handles one verified message. `splitPercent` is the share in force now; it is stored with a payment the first time
 * the payment is seen and never changed after. Throws only for a database failure, so the route answers 500 and Polar sends it again.
 */
export async function handlePolarEvent(db: Db, mode: PolarMode, raw: unknown, splitPercent: number): Promise<EventOutcome> {
  const outer = envelope.safeParse(raw);
  if (!outer.success) return ignored("bad_message");
  const { type, data } = outer.data;

  if (SUBSCRIPTION_EVENTS.has(type)) {
    const parsed = subscriptionData.safeParse(data);
    if (!parsed.success) return ignored("bad_message");
    return (await saveSubscription(db, mode, parsed.data)) ? { kind: "subscription", polarId: parsed.data.id } : ignored("not_ours");
  }

  if (ORDER_EVENTS.has(type)) {
    const parsed = orderData.safeParse(data);
    if (!parsed.success) return ignored("bad_message");
    const order = parsed.data;
    if (!order.subscription_id || !PAYING_REASONS.has(order.billing_reason)) return ignored("not_ours");
    if (order.currency.toLowerCase() !== CURRENCY) return ignored("not_usd");
    if (!PAID_STATUSES.has(order.status)) return ignored("not_paid");

    // An order can arrive before its subscription's own message; it carries the subscription, so make it first.
    if (order.subscription) await saveSubscription(db, mode, order.subscription);
    const sub = await db
      .select({ id: subscriptions.id, creatorId: subscriptions.creatorId, subscriberId: subscriptions.subscriberId })
      .from(subscriptions)
      .where(eq(subscriptions.polarId, order.subscription_id))
      .get();
    if (!sub) return ignored("not_ours");

    const modified = order.modified_at ?? order.created_at;
    const share = creatorShareCents(order.net_amount, order.refunded_amount, splitPercent);
    await db
      .insert(subscriptionPayments)
      .values({
        id: newId("subscriptionPayment"),
        polarOrderId: order.id,
        subscriptionId: sub.id,
        mode,
        creatorId: sub.creatorId,
        subscriberId: sub.subscriberId,
        netCents: order.net_amount,
        refundedCents: order.refunded_amount,
        splitPercent,
        creatorCents: share,
        paidAt: new Date(order.created_at),
        polarModifiedAt: modified,
      })
      .onConflictDoUpdate({
        target: subscriptionPayments.polarOrderId,
        set: {
          netCents: order.net_amount,
          refundedCents: order.refunded_amount,
          // The percent stored with the payment decides, not today's: the member's share of a refund is taken back at the rate it was earned.
          creatorCents: sql`(max(0, ${order.net_amount} - ${order.refunded_amount}) * ${subscriptionPayments.splitPercent}) / 100`,
          polarModifiedAt: modified,
          updatedAt: new Date(),
        },
        setWhere: sql`${subscriptionPayments.polarModifiedAt} <= ${modified}`,
      });
    return { kind: "payment", polarOrderId: order.id };
  }

  return ignored("other_event");
}
