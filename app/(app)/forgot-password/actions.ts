"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { createNextAuth } from "@/auth/next";
import { getDb } from "@/db";
import { transportFor } from "@/email/transport";
import { requestPasswordReset, resetEmailSender } from "@/server/password-reset";
import { clientIp, limitPasswordResetRequest, tooManyMessage } from "@/server/rate-limit";
import { siteOrigin } from "@/server/origin";

export type RequestResetActionResult = { ok: true } | { ok: false; message: string };

/**
 * Asks for a reset link. The answer is the same for an address that belongs to a member and one
 * that does not, and the email is sent after the response so the time taken is the same too.
 */
export async function requestResetAction(input: { email: string }): Promise<RequestResetActionResult> {
  const { env, ctx: workerCtx } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const requestHeaders = await headers();
  const email = typeof input?.email === "string" ? input.email : "";

  const limited = await limitPasswordResetRequest(env.DB, env.AUTH_SECRET, { ip: clientIp(requestHeaders), email });
  if (!limited.ok) return { ok: false, message: tooManyMessage(limited.retryAfterSeconds) };

  const mail = { transport: transportFor(env), encryptionKey: env.SETTINGS_ENCRYPTION_KEY, origin: siteOrigin(env, requestHeaders) };
  const auth = createNextAuth(
    { DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL },
    { sendResetPassword: resetEmailSender(db, mail), background: (promise) => workerCtx.waitUntil(promise) },
  );
  return requestPasswordReset(auth, db, email);
}
