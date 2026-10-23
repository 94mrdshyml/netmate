// Email settings and sending (docs/PRD.md section 7). The Resend key and the sender address are
// stored encrypted in `instance_secrets`; the browser is never given either back. Everything that
// sends mail goes through `sendEmail`, which records the result for /hq/email.

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { emailState, instanceSecrets } from "@/db/schema";
import { scrubError, type OutgoingEmail, type SendResult, type Transport } from "@/email/transport";
import { brandedEmail, type EmailBrand } from "@/email/template";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const KEY = "resend_api_key";
const FROM = "resend_from";

export type EmailConfig = { apiKey: string; from: string };

/** Whether both secrets are stored. A cheap read that decrypts nothing, used for the banner. */
export async function isEmailSetUp(db: Db): Promise<boolean> {
  const rows = await db.select({ name: instanceSecrets.name }).from(instanceSecrets).where(inArray(instanceSecrets.name, [KEY, FROM]));
  return rows.length === 2;
}

/** The decrypted key and sender, or why there are none. */
export async function readEmailConfig(
  db: Db,
  encryptionKey: string | undefined,
): Promise<{ ok: true; config: EmailConfig } | { ok: false; reason: "missing" | "unreadable" }> {
  const rows = await db.select().from(instanceSecrets).where(inArray(instanceSecrets.name, [KEY, FROM]));
  const key = rows.find((r) => r.name === KEY);
  const from = rows.find((r) => r.name === FROM);
  if (!key || !from) return { ok: false, reason: "missing" };
  if (!encryptionKey) return { ok: false, reason: "unreadable" };
  try {
    return {
      ok: true,
      config: { apiKey: await decryptSecret(key.value, KEY, encryptionKey), from: await decryptSecret(from.value, FROM, encryptionKey) },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export type EmailPanel = {
  state: "not_set_up" | "set_up" | "unreadable";
  /** The sender address. Never the key. */
  from: string | null;
  lastSentAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
};

export async function emailPanel(db: Db, encryptionKey: string | undefined): Promise<EmailPanel> {
  const status = await db.select().from(emailState).where(eq(emailState.id, "singleton")).get();
  const base = { lastSentAt: status?.lastSentAt ?? null, lastError: status?.lastError ?? null, lastErrorAt: status?.lastErrorAt ?? null };
  const config = await readEmailConfig(db, encryptionKey);
  if (config.ok) return { state: "set_up", from: config.config.from, ...base };
  return { state: config.reason === "missing" ? "not_set_up" : "unreadable", from: null, ...base };
}

const saveSchema = z.object({
  apiKey: z.string().trim().max(200, "That key is too long").optional(),
  from: z
    .string()
    .trim()
    .min(1, "Enter the address emails are sent from")
    .max(254, "That address is too long")
    .pipe(z.email("Enter a valid email address")),
});

export type SaveEmailResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "resend_invalid" | "resend_unreachable" | "failed"; fieldErrors: Record<string, string> };

/**
 * Saves the sender and, when one is given, the key. A blank key keeps the saved one. A new key is
 * checked with a real call to Resend first (a sending-only key counts as valid).
 */
export async function saveEmailSettings(
  db: Db,
  transport: Transport,
  encryptionKey: string | undefined,
  raw: unknown,
): Promise<SaveEmailResult> {
  const parsed = saveSchema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      if (!(field in fieldErrors)) fieldErrors[field] = issue.message;
    }
  }
  // Read the key even when another field failed, so every problem is reported in one go.
  const typed = (raw as { apiKey?: unknown } | null)?.apiKey;
  const apiKey = parsed.success ? (parsed.data.apiKey ?? "") : typeof typed === "string" ? typed.trim() : "";
  if (apiKey && !apiKey.startsWith("re_")) fieldErrors.apiKey ??= "A Resend key starts with re_";
  const saved = await db.select({ name: instanceSecrets.name }).from(instanceSecrets).where(eq(instanceSecrets.name, KEY)).get();
  if (!apiKey && !saved) fieldErrors.apiKey ??= "Enter your Resend key";
  if (Object.keys(fieldErrors).length > 0 || !parsed.success) return { ok: false, code: "invalid", fieldErrors };
  if (!encryptionKey) return { ok: false, code: "failed", fieldErrors: {} };

  if (apiKey) {
    const check = await transport.checkKey(apiKey);
    if (!check.ok) {
      return check.reason === "invalid"
        ? { ok: false, code: "resend_invalid", fieldErrors: { apiKey: "Resend did not accept that key" } }
        : { ok: false, code: "resend_unreachable", fieldErrors: { apiKey: "Could not reach Resend. Try again in a minute" } };
    }
  }

  try {
    const statement = (name: string, value: string) =>
      db.insert(instanceSecrets).values({ name, value }).onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } });
    const sender = statement(FROM, await encryptSecret(parsed.data.from, FROM, encryptionKey));
    // The key row is written only when a new key came in; both go in one batch.
    if (apiKey) await db.batch([sender, statement(KEY, await encryptSecret(apiKey, KEY, encryptionKey))]);
    else await sender;
  } catch {
    return { ok: false, code: "failed", fieldErrors: {} };
  }
  return { ok: true };
}

/** Forgets the key and sender, so the instance goes back to "email is not set up". */
export async function removeEmailSettings(db: Db): Promise<boolean> {
  try {
    await db.batch([db.delete(instanceSecrets).where(inArray(instanceSecrets.name, [KEY, FROM])), db.delete(emailState)]);
    return true;
  } catch {
    return false;
  }
}

async function record(db: Db, result: SendResult): Promise<void> {
  const now = new Date();
  const values = result.ok ? { lastSentAt: now, lastError: null, lastErrorAt: null } : { lastError: scrubError(result.message), lastErrorAt: now };
  try {
    await db.insert(emailState).values({ id: "singleton", ...values }).onConflictDoUpdate({ target: emailState.id, set: values });
  } catch {
    // The email already went (or failed); losing the note about it must not change that.
  }
}

/** Sends one email through the saved key and sender, and records how it went for /hq/email. */
export async function sendEmail(
  db: Db,
  transport: Transport,
  encryptionKey: string | undefined,
  email: Omit<OutgoingEmail, "from">,
): Promise<SendResult> {
  const config = await readEmailConfig(db, encryptionKey);
  if (!config.ok) {
    return {
      ok: false,
      message: config.reason === "missing" ? "Email is not set up." : "The saved email settings cannot be read. Enter the Resend key again.",
    };
  }
  const result = await transport.send(config.config.apiKey, { ...email, from: config.config.from });
  await record(db, result);
  return result;
}

/** The test message, branded like every real email, sent to the admin's own address. */
export function sendTestEmail(db: Db, transport: Transport, encryptionKey: string | undefined, brand: EmailBrand, to: string): Promise<SendResult> {
  const { html, text } = brandedEmail(brand, {
    heading: "Email is working",
    paragraphs: [`This is a test email from ${brand.name}. If you can read it, sign-up and password emails will reach people.`],
  });
  return sendEmail(db, transport, encryptionKey, { to, subject: `Test email from ${brand.name}`, html, text });
}
