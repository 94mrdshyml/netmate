// The logic of the Polar webhook address, apart from the route so it can be tested without a server. Anyone on the
// internet can post to that address, so nothing is read before the signature is checked against the owner's webhook
// secret. The body is never logged.

import type { Db } from "@/db";
import { readWebhookHeaders, verifyWebhook } from "@/payments/webhook";
import { readAccess, readPaymentSettings } from "@/server/payments";
import { handlePolarEvent } from "@/server/polar-events";

export const WEBHOOK_MAX_BODY = 512 * 1024;

export type WebhookReply = { status: 200 | 400 | 401 | 404 | 413 | 500; body: Record<string, unknown> };

/**
 * 200 once a message is handled or deliberately ignored; 401 when it is not signed by Polar; 404 when no keys are saved
 * (there is nothing to check a signature against, so the address does not exist); 400 for a signed body that is not JSON;
 * 500 only when our database failed, so Polar sends the message again.
 */
export async function processPolarWebhook(db: Db, encryptionKey: string | undefined, body: string, headers: Headers, now: number = Date.now()): Promise<WebhookReply> {
  if (body.length > WEBHOOK_MAX_BODY) return { status: 413, body: {} };

  const access = await readAccess(db, encryptionKey);
  if (!access) return { status: 404, body: {} };
  if (!(await verifyWebhook(body, readWebhookHeaders(headers), access.webhookSecret, now))) return { status: 401, body: {} };

  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return { status: 400, body: {} };
  }

  try {
    const settings = await readPaymentSettings(db);
    const outcome = await handlePolarEvent(db, access.mode, message, { splitPercent: settings.creatorPercent, feeBp: settings.feeBp, feeFixedCents: settings.feeFixedCents });
    return { status: 200, body: { ok: true, handled: outcome.kind !== "ignored" } };
  } catch {
    return { status: 500, body: {} };
  }
}
