// Paid subscriptions between members (docs/PRD.md, "Paid subscriptions"). A member sets a monthly price; another taps
// Subscribe and pays on Polar's own page; Polar's webhooks (src/server/polar-events.ts) then tell us what happened.
// Nothing here ever trusts the browser for who pays whom: ids come from the session, and a subscription exists only
// because a signed Polar message said so.

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { blocks, polarProducts, profiles, subscriptions } from "@/db/schema";
import { isId } from "@/lib/ids";
import { CURRENCY, parsePrice } from "@/lib/money";
import { polarCall } from "@/payments/polar";
import { META_CREATOR, META_SUBSCRIBER } from "@/server/polar-events";
import { readAccess, readPaymentSettings } from "@/server/payments";

/** A subscription whose end-of-period message never reached us is trusted for this long past its period, then stops. */
export const ACCESS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** The states in which a subscriber has paid up. A subscription they stopped keeps one of these until the period ends. */
const LIVE = ["active", "trialing"] as const;

// ---- what a member charges ----

export type PriceResult = { ok: true; priceCents: number | null } | { ok: false; message: string };

/** Sets what the signed-in member charges a month ($1 to $100). Existing subscribers keep the price they agreed to. */
export async function setSubscriptionPrice(db: Db, userId: string, raw: unknown): Promise<PriceResult> {
  const price = parsePrice(raw);
  if (!price.ok) return price;
  await db.update(profiles).set({ subscriptionPriceCents: price.cents }).where(and(eq(profiles.userId, userId), eq(profiles.status, "active")));
  return { ok: true, priceCents: price.cents };
}

/** Stops offering new subscriptions. People already subscribed stay subscribed until they stop it themselves. */
export async function clearSubscriptionPrice(db: Db, userId: string): Promise<PriceResult> {
  await db.update(profiles).set({ subscriptionPriceCents: null }).where(eq(profiles.userId, userId));
  return { ok: true, priceCents: null };
}

export type MySubscriptionSettings = {
  /** Whether the owner has switched subscriptions on. Nothing else here matters when it is off. */
  enabled: boolean;
  testMode: boolean;
  priceCents: number | null;
  creatorPercent: number;
  /** How many people are subscribed now: a number, never names. */
  subscribers: number;
};

export async function mySubscriptionSettings(db: Db, userId: string): Promise<MySubscriptionSettings> {
  const settings = await readPaymentSettings(db);
  const me = await db.select({ price: profiles.subscriptionPriceCents }).from(profiles).where(eq(profiles.userId, userId)).get();
  const [row] = await db.all<{ n: number }>(
    sql`select count(distinct subscriber_id) as n from subscriptions where creator_id = ${userId} and mode = ${settings.mode} and status in ('active', 'trialing')`,
  );
  return { enabled: settings.enabled, testMode: settings.mode === "sandbox", priceCents: me?.price ?? null, creatorPercent: settings.creatorPercent, subscribers: row?.n ?? 0 };
}

// ---- who is subscribed ----

/** True when `subscriberId` has a paid-up subscription to `creatorId` in the mode the site is in now. */
export async function hasSubscriberAccess(db: Db, subscriberId: string, creatorId: string, now: number = Date.now()): Promise<boolean> {
  const settings = await readPaymentSettings(db);
  const row = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriberId, subscriberId),
        eq(subscriptions.creatorId, creatorId),
        eq(subscriptions.mode, settings.mode),
        inArray(subscriptions.status, [...LIVE]),
        sql`(${subscriptions.currentPeriodEnd} is null or ${subscriptions.currentPeriodEnd} > ${now - ACCESS_GRACE_MS})`,
      ),
    )
    .get();
  return row !== undefined;
}

export type SubscribeState = {
  /** The monthly price, when this person may be subscribed to by the viewer right now. */
  offerCents: number | null;
  /** The viewer's live subscription to this person, if any. */
  mine: { id: string; cancelAtPeriodEnd: boolean; renewsOrEndsAt: number | null } | null;
  testMode: boolean;
};

/** What a profile shows the viewer: a Subscribe button, a "Subscribed" line, or nothing. Off whenever the owner has it off. */
export async function subscribeState(db: Db, viewerId: string, creatorId: string): Promise<SubscribeState> {
  const settings = await readPaymentSettings(db);
  const none: SubscribeState = { offerCents: null, mine: null, testMode: settings.mode === "sandbox" };
  if (!settings.enabled || viewerId === creatorId) return none;
  const creator = await db.select({ price: profiles.subscriptionPriceCents, status: profiles.status }).from(profiles).where(eq(profiles.userId, creatorId)).get();
  if (!creator || creator.status !== "active") return none;

  const mine = await db
    .select({ id: subscriptions.id, cancel: subscriptions.cancelAtPeriodEnd, end: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriberId, viewerId),
        eq(subscriptions.creatorId, creatorId),
        eq(subscriptions.mode, settings.mode),
        inArray(subscriptions.status, [...LIVE]),
        sql`(${subscriptions.currentPeriodEnd} is null or ${subscriptions.currentPeriodEnd} > ${Date.now() - ACCESS_GRACE_MS})`,
      ),
    )
    .limit(1)
    .get();
  return {
    offerCents: mine ? null : creator.price,
    mine: mine ? { id: mine.id, cancelAtPeriodEnd: mine.cancel, renewsOrEndsAt: mine.end ? mine.end.getTime() : null } : null,
    testMode: none.testMode,
  };
}

export type MySubscription = {
  id: string;
  creator: { userId: string; username: string; firstName: string; lastName: string };
  priceCents: number;
  cancelAtPeriodEnd: boolean;
  renewsOrEndsAt: number | null;
};

/** The people the viewer pays, for Settings. Only live subscriptions in the mode the site is in. */
export async function listMySubscriptions(db: Db, viewerId: string): Promise<MySubscription[]> {
  const settings = await readPaymentSettings(db);
  const rows = await db
    .select({
      id: subscriptions.id,
      userId: profiles.userId,
      username: profiles.username,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      price: subscriptions.priceCents,
      cancel: subscriptions.cancelAtPeriodEnd,
      end: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(profiles, eq(profiles.userId, subscriptions.creatorId))
    .where(and(eq(subscriptions.subscriberId, viewerId), eq(subscriptions.mode, settings.mode), inArray(subscriptions.status, [...LIVE])))
    .orderBy(sql`${subscriptions.createdAt} desc`)
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    creator: { userId: r.userId, username: r.username, firstName: r.firstName, lastName: r.lastName },
    priceCents: r.price,
    cancelAtPeriodEnd: r.cancel,
    renewsOrEndsAt: r.end ? r.end.getTime() : null,
  }));
}

// ---- subscribing ----

/** Polar's pages live on polar.sh or one of its subdomains (the test site too). Nothing else is ever redirected to. */
export function isPolarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"));
  } catch {
    return false;
  }
}

const idOnly = z.object({ id: z.string().min(1).max(100) });
const checkoutOut = z.object({ id: z.string().min(1).max(100), url: z.string().min(1).max(2100) });

type Access = NonNullable<Awaited<ReturnType<typeof readAccess>>>;

/** The Polar product for this member at this price: found, or made the first time and kept for every later subscriber. */
async function productFor(db: Db, access: Access, creator: { userId: string; username: string }, priceCents: number, siteName: string) {
  const find = () =>
    db
      .select({ productId: polarProducts.productId })
      .from(polarProducts)
      .where(and(eq(polarProducts.mode, access.mode), eq(polarProducts.creatorId, creator.userId), eq(polarProducts.priceCents, priceCents)))
      .get();
  const have = await find();
  if (have) return { ok: true as const, productId: have.productId };

  const made = await polarCall(access.mode, access.token, "/v1/products/", {
    method: "POST",
    json: {
      name: `Subscription to @${creator.username}`,
      description: `A monthly subscription to the posts @${creator.username} shares with subscribers on ${siteName}.`,
      recurring_interval: "month",
      // Private: it is for our checkout only and should not be listed on the owner's public Polar page.
      visibility: "private",
      metadata: { [META_CREATOR]: creator.userId },
      prices: [{ amount_type: "fixed", price_currency: CURRENCY, price_amount: priceCents }],
    },
  });
  if (!made.ok) return { ok: false as const, message: made.message };
  const parsed = idOnly.safeParse(made.body);
  if (!parsed.success) return { ok: false as const, message: "Polar sent back something we could not read." };
  // Two people subscribing at once may both make one; the first stored wins and the other is simply left unused.
  await db.insert(polarProducts).values({ mode: access.mode, creatorId: creator.userId, priceCents, productId: parsed.data.id }).onConflictDoNothing();
  return { ok: true as const, productId: (await find())?.productId ?? parsed.data.id };
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Starts a subscription: makes a Polar checkout for the member's product and returns Polar's page address. Polar is
 * given only our ids for the two people (no names, no email: the subscriber types their email on Polar's own page).
 */
export async function startCheckout(
  db: Db,
  encryptionKey: string | undefined,
  input: { subscriberId: string; creatorId: unknown; siteName: string; origin: string },
): Promise<CheckoutResult> {
  const settings = await readPaymentSettings(db);
  if (!settings.enabled) return { ok: false, message: "Subscriptions are not turned on here." };
  const access = await readAccess(db, encryptionKey);
  if (!access) return { ok: false, message: "Subscriptions are not set up properly. Tell the person who runs this space." };

  if (!isId("user", input.creatorId) || input.creatorId === input.subscriberId) return { ok: false, message: "That person is not available." };
  const creator = await db
    .select({ userId: profiles.userId, username: profiles.username, price: profiles.subscriptionPriceCents, status: profiles.status })
    .from(profiles)
    .where(eq(profiles.userId, input.creatorId))
    .get();
  if (!creator || creator.status !== "active" || creator.price === null) return { ok: false, message: "That person does not offer a subscription." };

  const blocked = await db
    .select({ one: sql<number>`1` })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, input.subscriberId), eq(blocks.blockedId, creator.userId)), and(eq(blocks.blockerId, creator.userId), eq(blocks.blockedId, input.subscriberId))))
    .get();
  if (blocked) return { ok: false, message: "That person is not available." };

  if (await hasSubscriberAccess(db, input.subscriberId, creator.userId)) return { ok: false, message: "You are already subscribed." };

  const product = await productFor(db, access, creator, creator.price, input.siteName);
  if (!product.ok) return product;

  const checkout = await polarCall(access.mode, access.token, "/v1/checkouts/", {
    method: "POST",
    json: {
      products: [product.productId],
      external_customer_id: input.subscriberId,
      metadata: { [META_CREATOR]: creator.userId, [META_SUBSCRIBER]: input.subscriberId },
      success_url: `${input.origin}/subscribe/done?creator=${creator.username}&checkout_id={CHECKOUT_ID}`,
      return_url: `${input.origin}/${creator.username}`,
    },
  });
  if (!checkout.ok) return { ok: false, message: checkout.message };
  const parsed = checkoutOut.safeParse(checkout.body);
  if (!parsed.success || !isPolarUrl(parsed.data.url)) return { ok: false, message: "Polar sent back something we could not use." };
  return { ok: true, url: parsed.data.url };
}

// ---- stopping ----

export type RenewResult = { ok: true; cancelAtPeriodEnd: boolean } | { ok: false; message: string };

/**
 * Sets whether a subscription renews (the state wanted, not a flip). Stopping keeps access to the end of the period
 * already paid for. Polar is told first; our row follows at once and Polar's own message confirms it a moment later.
 */
export async function setAutoRenew(db: Db, encryptionKey: string | undefined, subscriberId: string, subscriptionId: unknown, renew: unknown): Promise<RenewResult> {
  if (!isId("subscription", subscriptionId) || typeof renew !== "boolean") return { ok: false, message: "That subscription is not available." };
  const settings = await readPaymentSettings(db);
  const row = await db
    .select({ polarId: subscriptions.polarId, cancel: subscriptions.cancelAtPeriodEnd })
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.subscriberId, subscriberId), eq(subscriptions.mode, settings.mode), inArray(subscriptions.status, [...LIVE])))
    .get();
  if (!row) return { ok: false, message: "That subscription is not available." };
  if (row.cancel === !renew) return { ok: true, cancelAtPeriodEnd: row.cancel };

  const access = await readAccess(db, encryptionKey);
  if (!access) return { ok: false, message: "Subscriptions are not set up properly. Tell the person who runs this space." };
  const done = await polarCall(access.mode, access.token, `/v1/subscriptions/${encodeURIComponent(row.polarId)}`, { method: "PATCH", json: { cancel_at_period_end: !renew } });
  if (!done.ok) return { ok: false, message: done.message };
  await db.update(subscriptions).set({ cancelAtPeriodEnd: !renew, updatedAt: new Date() }).where(eq(subscriptions.id, subscriptionId));
  return { ok: true, cancelAtPeriodEnd: !renew };
}
