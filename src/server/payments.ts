// Paid subscriptions: the owner's connection to Polar and the split (docs/PRD.md, "Paid subscriptions"). The Polar
// access token and the webhook secret are stored encrypted in `instance_secrets`, like the Resend and Klipy keys, are
// never shown back in /hq and never go to a browser. Money from members goes to the owner's Polar account; this module
// only holds the settings and checks the connection.

import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "@/db";
import { instanceSecrets, paymentSettings } from "@/db/schema";
import { isPercent } from "@/lib/money";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { isPolarMode, polarCall, type PolarMode } from "@/payments/polar";

const TOKEN = "polar_access_token";
const WEBHOOK = "polar_webhook_secret";

const NO_KEY = "This server cannot store keys safely yet. Ask whoever runs it to set SETTINGS_ENCRYPTION_KEY.";

export type PaymentSettings = { enabled: boolean; mode: PolarMode; creatorPercent: number };

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = { enabled: false, mode: "sandbox", creatorPercent: 50 };

/** The saved settings, or the defaults when nothing has been saved. */
export async function readPaymentSettings(db: Db): Promise<PaymentSettings> {
  const row = await db.select().from(paymentSettings).where(eq(paymentSettings.id, "singleton")).get();
  if (!row) return DEFAULT_PAYMENT_SETTINGS;
  return { enabled: row.enabled, mode: isPolarMode(row.mode) ? row.mode : "sandbox", creatorPercent: row.creatorPercent };
}

export type PaymentPanel = PaymentSettings & {
  hasToken: boolean;
  hasWebhookSecret: boolean;
  /** False when a key is saved but cannot be read (SETTINGS_ENCRYPTION_KEY changed): the owner must paste it again. */
  readable: boolean;
};

/** What /hq/payments shows. Never a key itself. */
export async function paymentPanel(db: Db, encryptionKey: string | undefined): Promise<PaymentPanel> {
  const settings = await readPaymentSettings(db);
  const rows = await db.select({ name: instanceSecrets.name }).from(instanceSecrets);
  const hasToken = rows.some((r) => r.name === TOKEN);
  const hasWebhookSecret = rows.some((r) => r.name === WEBHOOK);
  const readable = !(hasToken || hasWebhookSecret) || (await readAccess(db, encryptionKey)) !== null;
  return { ...settings, hasToken, hasWebhookSecret, readable };
}

export type PolarAccess = { mode: PolarMode; token: string; webhookSecret: string };

/** The token and webhook secret for server code that talks to Polar. Null unless both are saved and readable. */
export async function readAccess(db: Db, encryptionKey: string | undefined): Promise<PolarAccess | null> {
  if (!encryptionKey) return null;
  try {
    const rows = await db.select().from(instanceSecrets);
    const token = rows.find((r) => r.name === TOKEN);
    const secret = rows.find((r) => r.name === WEBHOOK);
    if (!token || !secret) return null;
    const settings = await readPaymentSettings(db);
    return {
      mode: settings.mode,
      token: await decryptSecret(token.value, TOKEN, encryptionKey),
      webhookSecret: await decryptSecret(secret.value, WEBHOOK, encryptionKey),
    };
  } catch {
    return null;
  }
}

export type SaveResult = { ok: true } | { ok: false; message: string };

const TOKEN_SHAPE = /^[A-Za-z0-9_.\-]{16,300}$/;
const SECRET_SHAPE = /^[A-Za-z0-9_.\-+/=]{16,300}$/;

/**
 * Saves the mode, and a new token and/or webhook secret when they are given (a blank box keeps what is saved). Both
 * secrets and the mode are written in one batch, or none of them.
 */
export async function savePaymentConnection(
  db: Db,
  encryptionKey: string | undefined,
  input: { mode: unknown; accessToken?: unknown; webhookSecret?: unknown },
): Promise<SaveResult> {
  if (!isPolarMode(input.mode)) return { ok: false, message: "Choose test mode or live mode." };
  const token = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  const secret = typeof input.webhookSecret === "string" ? input.webhookSecret.trim() : "";
  if (token !== "" && !TOKEN_SHAPE.test(token)) return { ok: false, message: "That does not look like a Polar access token. Copy it again from Polar, with nothing around it." };
  if (secret !== "" && !SECRET_SHAPE.test(secret)) return { ok: false, message: "That does not look like a Polar webhook secret. Copy it again from Polar, with nothing around it." };
  if ((token !== "" || secret !== "") && !encryptionKey) return { ok: false, message: NO_KEY };

  try {
    const writes: BatchItem<"sqlite">[] = [
      db
        .insert(paymentSettings)
        .values({ id: "singleton", mode: input.mode })
        // Changing between test and live turns subscriptions off: the owner switches them on again on purpose.
        .onConflictDoUpdate({
          target: paymentSettings.id,
          set: { mode: input.mode, enabled: sql`case when ${paymentSettings.mode} = ${input.mode} then ${paymentSettings.enabled} else 0 end`, updatedAt: new Date() },
        }),
    ];
    for (const [name, text] of [[TOKEN, token], [WEBHOOK, secret]] as const) {
      if (text === "") continue;
      const value = await encryptSecret(text, name, encryptionKey as string);
      writes.push(db.insert(instanceSecrets).values({ name, value }).onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } }));
    }
    await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch {
    return { ok: false, message: "Could not save. Try again." };
  }
  return { ok: true };
}

/** Saves the share of each payment that goes to the member. Whole percent, 0 to 100. */
export async function savePaymentSplit(db: Db, creatorPercent: unknown): Promise<SaveResult> {
  const n = typeof creatorPercent === "string" && /^\d{1,3}$/.test(creatorPercent.trim()) ? Number(creatorPercent.trim()) : creatorPercent;
  if (!isPercent(n)) return { ok: false, message: "Enter a whole number from 0 to 100." };
  try {
    await db
      .insert(paymentSettings)
      .values({ id: "singleton", creatorPercent: n })
      .onConflictDoUpdate({ target: paymentSettings.id, set: { creatorPercent: n, updatedAt: new Date() } });
  } catch {
    return { ok: false, message: "Could not save. Try again." };
  }
  return { ok: true };
}

/** The owner's switch for the whole feature. Turning it on needs both keys saved and readable. */
export async function setPaymentsEnabled(db: Db, encryptionKey: string | undefined, wanted: unknown): Promise<SaveResult> {
  if (typeof wanted !== "boolean") return { ok: false, message: "Choose on or off." };
  if (wanted && (await readAccess(db, encryptionKey)) === null) return { ok: false, message: "Save the access token and the webhook secret first." };
  try {
    await db
      .insert(paymentSettings)
      .values({ id: "singleton", enabled: wanted })
      .onConflictDoUpdate({ target: paymentSettings.id, set: { enabled: wanted, updatedAt: new Date() } });
  } catch {
    return { ok: false, message: "Could not save. Try again." };
  }
  return { ok: true };
}

/** Forgets the token and the webhook secret, and turns subscriptions off (they cannot work without them). */
export async function removePaymentKeys(db: Db): Promise<boolean> {
  try {
    await db.batch([
      db.delete(instanceSecrets).where(eq(instanceSecrets.name, TOKEN)),
      db.delete(instanceSecrets).where(eq(instanceSecrets.name, WEBHOOK)),
      db.update(paymentSettings).set({ enabled: false, updatedAt: new Date() }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export type TestResult = { ok: true; message: string } | { ok: false; message: string };

/** Asks Polar for one product with the saved token, to prove the token and the mode agree. Says in plain words what went wrong. */
export async function testPolar(db: Db, encryptionKey: string | undefined): Promise<TestResult> {
  const access = await readAccess(db, encryptionKey);
  if (!access) return { ok: false, message: "Save the access token and the webhook secret first." };
  const result = await polarCall<{ pagination?: { total_count?: number } }>(access.mode, access.token, "/v1/products/?limit=1");
  if (!result.ok) return { ok: false, message: result.status === 401 && access.mode === "production" ? `${result.message} Check that this token was made in live mode, not test mode.` : result.message };
  return { ok: true, message: `Connected to Polar in ${access.mode === "sandbox" ? "test" : "live"} mode.` };
}
