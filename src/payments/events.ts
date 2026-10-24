// What Polar's webhook messages look like, as far as this app reads them (checked against Polar's published API
// description, version 2026-10). Everything not listed here is ignored. Each reader is strict about the fields it
// uses, so a message with the wrong shape is refused instead of half-believed.

import { z } from "zod";
import { SUBSCRIPTION_STATUSES } from "@/db/app-schema";

/** Polar's times are ISO text; we keep milliseconds. */
const when = z.string().transform((text, ctx) => {
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: "custom", message: "not a time" });
    return z.NEVER;
  }
  return ms;
});

const metadata = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});

export const subscriptionData = z.object({
  id: z.string().min(1).max(100),
  created_at: when,
  modified_at: when.nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  amount: z.number().int().min(0),
  currency: z.string().min(1).max(10),
  cancel_at_period_end: z.boolean(),
  current_period_end: when.nullable(),
  metadata,
});
export type PolarSubscription = z.infer<typeof subscriptionData>;

export const ORDER_STATUSES = ["draft", "pending", "paid", "refunded", "partially_refunded", "void"] as const;

export const orderData = z.object({
  id: z.string().min(1).max(100),
  created_at: when,
  modified_at: when.nullable(),
  status: z.enum(ORDER_STATUSES),
  net_amount: z.number().int().min(0),
  refunded_amount: z.number().int().min(0),
  currency: z.string().min(1).max(10),
  billing_reason: z.string().max(60),
  subscription_id: z.string().max(100).nullable(),
  metadata,
  /** The subscription the order belongs to, in full, so an order that arrives first can still make its subscription. */
  subscription: subscriptionData.nullable().optional(),
});
export type PolarOrder = z.infer<typeof orderData>;

export const envelope = z.object({ type: z.string().min(1).max(60), data: z.unknown() });

/** The subscription events we act on. The others (and every event about other things) are acknowledged and ignored. */
export const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.cycled",
  "subscription.revoked",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
]);

export const ORDER_EVENTS: ReadonlySet<string> = new Set(["order.created", "order.updated", "order.paid", "order.refunded"]);

/** Orders that count as a member's earnings: a first payment, a renewal or a change, and in a state where money moved. */
export const PAYING_REASONS: ReadonlySet<string> = new Set(["subscription_create", "subscription_cycle", "subscription_update"]);
export const PAID_STATUSES: ReadonlySet<string> = new Set(["paid", "partially_refunded", "refunded"]);
