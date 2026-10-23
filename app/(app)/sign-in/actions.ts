"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createNextAuth } from "@/auth/next";
import { signInMember, type SignInFailure } from "@/auth/sign-in";
import { getDb } from "@/db";
import { clientIp, limitSignIn, tooManyMessage } from "@/server/rate-limit";

export type SignInActionResult = { ok: false; code: SignInFailure | "rate_limited"; message: string };

/** Signs a member in and goes to Home. Only returns on failure. */
export async function signInAction(input: { email: string; password: string }): Promise<SignInActionResult> {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createNextAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });

  const requestHeaders = await headers();
  const limited = await limitSignIn(env.DB, env.AUTH_SECRET, {
    ip: clientIp(requestHeaders),
    email: typeof input?.email === "string" ? input.email : "",
  });
  if (!limited.ok) return { ok: false, code: "rate_limited", message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await signInMember(auth, getDb(env.DB), input, requestHeaders);
  if (!result.ok) return result;
  redirect("/");
}

/** Ends this browser's session and goes to the sign-in page. */
export async function signOutAction(): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createNextAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // No session to end: the goal (signed out) already holds.
  }
  redirect("/sign-in");
}
