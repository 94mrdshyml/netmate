"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createNextAuth } from "@/auth/next";
import type { SetupInput } from "@/instance/setup-schema";
import { completeSetup, type SetupResult } from "@/instance/setup";

export type SetupFailureResult = Extract<SetupResult, { ok: false }>;

/** Finishes setup, signs the new admin in, and goes to the home page. Only returns on failure. */
export async function completeSetupAction(input: SetupInput): Promise<SetupFailureResult> {
  const { env } = await getCloudflareContext({ async: true });

  const result = await completeSetup(env, input);
  if (!result.ok) return result;

  const auth = createNextAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });
  await auth.api.signInEmail({ body: { email: result.email, password: input.password }, headers: await headers() });

  redirect("/");
}
