"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createNextAuth } from "@/auth/next";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { signUpWithInvite, type SignUpFailure } from "@/server/sign-up";

export type SignUpActionResult = {
  ok: false;
  code: SignUpFailure;
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

  const result = await signUpWithInvite(authEnv, input);
  if (!result.ok) return result;

  if (result.status === "pending") redirect("/waiting");

  const signedIn = await signInMember(
    createNextAuth(authEnv),
    getDb(env.DB),
    { email: result.email, password: input.password },
    await headers(),
  );
  // The account exists either way; if the automatic sign-in hiccups, the sign-in page works.
  redirect(signedIn.ok ? "/" : "/sign-in");
}
