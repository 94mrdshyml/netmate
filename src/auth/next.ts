// The Next.js flavour of createAuth: the nextCookies plugin lets server actions set the
// session cookie. Kept apart from createAuth because it imports next/headers, which the
// integration tests (plain Workers runtime) do not have.

import { nextCookies } from "better-auth/next-js";
import { createAuth, type AuthEnv } from "@/auth";

export function createNextAuth(env: AuthEnv) {
  // nextCookies must be the last plugin.
  return createAuth(env, { plugins: [nextCookies()] });
}
