"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createNextAuth } from "@/auth/next";
import { getDb } from "@/db";
import { resetPasswordWithToken } from "@/server/password-reset";
import { clientIp, limitPasswordResetSubmit, tooManyMessage } from "@/server/rate-limit";

export type ResetActionResult = { ok: false; code: "invalid" | "expired" | "failed" | "rate_limited"; message: string };

/** Sets the new password and goes to the sign-in page. Only returns on failure. */
export async function resetPasswordAction(input: { token: string; password: string }): Promise<ResetActionResult> {
  const { env } = await getCloudflareContext({ async: true });
  const requestHeaders = await headers();

  const limited = await limitPasswordResetSubmit(env.DB, env.AUTH_SECRET, clientIp(requestHeaders));
  if (!limited.ok) return { ok: false, code: "rate_limited", message: tooManyMessage(limited.retryAfterSeconds) };

  const auth = createNextAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });
  const result = await resetPasswordWithToken(auth, getDb(env.DB), { token: input?.token, password: input?.password });
  if (!result.ok) return result;
  redirect("/sign-in?reset=1");
}
