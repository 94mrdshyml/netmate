"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { limitCheckout, limitSubscriptionChange, tooManyMessage } from "@/server/rate-limit";
import { siteOrigin } from "@/server/origin";
import { readPaymentSettings } from "@/server/payments";
import { clearSubscriptionPrice, setAutoRenew, setSubscriptionPrice, startCheckout, type CheckoutResult, type PriceResult, type RenewResult } from "@/server/subscriptions";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

/** Sets what the signed-in member charges a month. Only while the owner has subscriptions on. */
export async function setPriceAction(input: string): Promise<PriceResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  if (!(await readPaymentSettings(db)).enabled) return { ok: false, message: "Subscriptions are not turned on here." };
  const result = await setSubscriptionPrice(db, member.userId, input);
  if (result.ok) {
    revalidatePath("/subscription");
    revalidatePath(`/${member.username}`);
  }
  return result;
}

/** Stops offering new subscriptions. People already subscribed keep theirs until they stop it. */
export async function clearPriceAction(): Promise<PriceResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const result = await clearSubscriptionPrice(getDb(env.DB), member.userId);
  revalidatePath("/subscription");
  revalidatePath(`/${member.username}`);
  return result;
}

/** Starts a subscription and gives back Polar's page address; the browser goes there. Ten a hour per person. */
export async function subscribeAction(creatorId: string): Promise<CheckoutResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitCheckout(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const { settings } = await getInstanceState();
  return startCheckout(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, {
    subscriberId: member.userId,
    creatorId,
    siteName: settings.name,
    origin: siteOrigin(env, await headers()),
  });
}

/** Stops or resumes renewing a subscription (the state wanted). Access lasts to the end of the period already paid for. */
export async function setAutoRenewAction(subscriptionId: string, renew: boolean): Promise<RenewResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });

  const limited = await limitSubscriptionChange(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await setAutoRenew(getDb(env.DB), env.SETTINGS_ENCRYPTION_KEY, member.userId, subscriptionId, renew);
  if (result.ok) revalidatePath("/subscriptions");
  return result;
}
