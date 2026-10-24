"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createNextAuth } from "@/auth/next";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { findActiveInvite } from "@/server/invites";
import { clientIp, limitSignUp, scopedSubject, tooManyMessage } from "@/server/rate-limit";
import { mailContext } from "@/server/mail-context";
import { signUpWithInvite, type SignUpFailure } from "@/server/sign-up";
import { emailAdminOfPending } from "@/server/status-emails";

export type SignUpActionResult = {
  ok: false;
  code: SignUpFailure | "rate_limited";
  message: string;
  fieldErrors?: Record<string, string>;
};

type SignUpInput = {
  invite: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
};

/** Creates the account. Auto-approved people are signed in and sent Home; others go to the waiting page. */
export async function signUpAction(input: SignUpInput): Promise<SignUpActionResult> {
  const { env } = await getCloudflareContext({ async: true });
  const authEnv = { DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL };

  const requestHeaders = await headers();
  const invite = await findActiveInvite(getDb(env.DB), input?.invite);
  // Browser tests only (ENV exactly "test"): sign-ups a test makes through the shared admin link count apart.
  const scope = env.ENV === "test" ? (await cookies()).get("e2e_scope")?.value : undefined;
  const limited = await limitSignUp(env.DB, env.AUTH_SECRET, {
    ip: clientIp(requestHeaders),
    inviteLinkId: scopedSubject(env, invite?.id ?? "none", scope),
  });
  if (!limited.ok) return { ok: false, code: "rate_limited", message: tooManyMessage(limited.retryAfterSeconds) };

  const result = await signUpWithInvite(authEnv, input);
  if (!result.ok) return result;

  if (result.status === "pending") {
    // The admin hears about it. A failed email never changes the sign-up.
    await emailAdminOfPending(getDb(env.DB), mailContext(env), result.userId);
    redirect("/waiting");
  }

  const signedIn = await signInMember(
    createNextAuth(authEnv),
    getDb(env.DB),
    { email: result.email, password: input.password },
    requestHeaders,
  );
  // The account exists either way; if the automatic sign-in hiccups, the sign-in page works.
  redirect(signedIn.ok ? "/" : "/sign-in");
}
