// The one-time setup of a fresh instance (docs/PRD.md section 4).
// Everything is written in a single D1 batch, so the admin, their profile, the instance
// settings and the encrypted keys all exist or none do. The instance row's fixed primary
// key means that if two people finish at once, exactly one batch succeeds.

import type { BatchItem } from "drizzle-orm/batch";
import { createAuth } from "@/auth";
import { getDb, schema } from "@/db";
import { checkResendKey } from "@/email/resend";
import { clearInstanceCache, readInstance } from "@/instance/settings";
import { validateSetup } from "@/instance/setup-schema";
import { newId } from "@/lib/ids";
import { safeEqual } from "@/lib/safe-compare";
import { encryptSecret } from "@/lib/secrets";

export type SetupEnv = {
  DB: D1Database;
  AUTH_SECRET?: string;
  SETUP_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  BETTER_AUTH_URL?: string;
};

export const MIN_SECRET_LENGTH = 32;

export type SetupFailure =
  | "not_configured"
  | "bad_token"
  | "invalid"
  | "already_configured"
  | "resend_invalid"
  | "resend_unreachable"
  | "email_taken"
  | "failed";

export type SetupResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: SetupFailure; message: string; fieldErrors?: Record<string, string> };

const fail = (code: SetupFailure, message: string, errors?: Record<string, string>): SetupResult => ({
  ok: false,
  code,
  message,
  ...(errors ? { fieldErrors: errors } : {}),
});

/** What the deployment is missing, if anything. Never includes secret values. */
export function setupProblems(env: SetupEnv): string[] {
  const problems: string[] = [];
  if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < MIN_SECRET_LENGTH) {
    problems.push(`SETUP_TOKEN is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < MIN_SECRET_LENGTH) {
    problems.push(`AUTH_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  if (!env.SETTINGS_ENCRYPTION_KEY || env.SETTINGS_ENCRYPTION_KEY.length < MIN_SECRET_LENGTH) {
    problems.push(`SETTINGS_ENCRYPTION_KEY is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  return problems;
}

export async function completeSetup(
  env: SetupEnv,
  rawInput: unknown,
  deps: { fetch?: typeof fetch } = {},
): Promise<SetupResult> {
  // 1. The deployment itself must be ready. Say what is missing, never a value.
  const problems = setupProblems(env);
  if (problems.length > 0) {
    return fail("not_configured", `This deployment is not ready for setup. ${problems.join(". ")}.`);
  }
  const { SETUP_TOKEN, AUTH_SECRET, SETTINGS_ENCRYPTION_KEY } = env as Required<SetupEnv>;

  // 2. Ownership: the token comes first, so strangers learn nothing about the form.
  const givenToken = (rawInput as { token?: unknown } | null)?.token;
  if (typeof givenToken !== "string" || !(await safeEqual(givenToken, SETUP_TOKEN))) {
    return fail("bad_token", "That setup token is not correct.", { token: "That setup token is not correct" });
  }

  // 3. Validate everything.
  const parsed = validateSetup(rawInput);
  if (!parsed.success) return fail("invalid", "Some answers need fixing.", parsed.errors);
  const data = parsed.data;
  const db = getDb(env.DB);

  // 4. Already set up? (checked again by the database itself below.)
  if ((await readInstance(db)).configured) {
    return fail("already_configured", "This instance has already been set up.");
  }

  // 5. The Resend key must work, checked with a real call.
  if (data.resendApiKey) {
    const check = await checkResendKey(data.resendApiKey, deps.fetch);
    if (!check.ok) {
      return check.reason === "invalid"
        ? fail("resend_invalid", "Resend did not accept that key.", { resendApiKey: "Resend did not accept that key" })
        : fail("resend_unreachable", "Could not reach Resend to check the key. Try again, or skip email for now.", {
            resendApiKey: "Could not reach Resend. Try again, or leave this empty",
          });
    }
  }

  // 6. Prepare every value first, so the write itself is a single quick batch.
  const auth = createAuth({ DB: env.DB, AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });
  const passwordHash = await (await auth.$context).password.hash(data.password);
  const userId = newId("user");

  const secretRows: { name: "resend_api_key" | "resend_from" | "klipy_api_key"; value: string }[] = [];
  const addSecret = async (name: "resend_api_key" | "resend_from" | "klipy_api_key", plain?: string) => {
    if (plain) secretRows.push({ name, value: await encryptSecret(plain, name, SETTINGS_ENCRYPTION_KEY) });
  };
  await addSecret("resend_api_key", data.resendApiKey);
  await addSecret("resend_from", data.resendFrom);
  await addSecret("klipy_api_key", data.klipyApiKey);

  const now = new Date();
  const statements: BatchItem<"sqlite">[] = [
    // The instance row goes first: its fixed key is the one-time claim, so a second attempt fails here.
    db.insert(schema.instance).values({
      name: data.name,
      primaryColor: data.primary,
      radius: data.radius,
      fontFamily: data.fontFamily,
      avatarStyle: data.avatarStyle,
      placesEnabled: data.placesEnabled,
      gifsEnabled: Boolean(data.klipyApiKey),
    }),
    db.insert(schema.user).values({ id: userId, name: `${data.firstName} ${data.lastName}`, email: data.email }),
    db.insert(schema.account).values({
      id: newId("account"),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      updatedAt: now,
    }),
    db.insert(schema.profiles).values({
      userId,
      username: data.username.trim().toLowerCase(),
      firstName: data.firstName,
      lastName: data.lastName,
      role: "admin",
      status: "active",
    }),
    ...secretRows.map((row) => db.insert(schema.instanceSecrets).values(row)),
  ];

  try {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (err) {
    const text = String((err as { cause?: { message?: string } })?.cause?.message ?? (err as Error)?.message ?? "");
    if (/instance\.id|instance_singleton/i.test(text)) {
      return fail("already_configured", "This instance has already been set up.");
    }
    if (/user\.email/i.test(text)) {
      return fail("email_taken", "That email is already in use.", { email: "That email is already in use" });
    }
    // Do not echo the database error: it can name columns and values.
    return fail("failed", "Setup could not be saved. Nothing was changed. Try again.");
  }

  clearInstanceCache();
  return { ok: true, userId, email: data.email };
}
