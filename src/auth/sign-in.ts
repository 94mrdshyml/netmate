// Member sign-in (docs/PRD.md section 5). Email and password; a Pending account never keeps a session.

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Auth } from "@/auth";
import type { Db } from "@/db";
import { profiles, session } from "@/db/schema";

export const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export type SignInFailure = "invalid" | "pending" | "suspended" | "failed";
export type SignInResult = { ok: true; userId: string } | { ok: false; code: SignInFailure; message: string };

const MESSAGES: Record<SignInFailure, string> = {
  // One message for an unknown email and a wrong password, so the form never tells who is a member.
  invalid: "That email and password do not match.",
  pending: "Your account is waiting for approval. You can sign in once the admin approves it.",
  suspended: "Your account is suspended. Ask the people who run this space if you think that is a mistake.",
  failed: "Could not sign you in. Try again in a moment.",
};

const fail = (code: SignInFailure): SignInResult => ({ ok: false, code, message: MESSAGES[code] });

/**
 * Checks the password, then the account status. A Pending account's session is removed again
 * straight away, and only after the password was right, so the waiting message is not shown to
 * someone who merely guessed an email.
 */
export async function signInMember(
  auth: Pick<Auth, "api">,
  db: Db,
  rawInput: unknown,
  headers?: Headers,
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid");

  try {
    const res = await auth.api.signInEmail({ body: parsed.data, headers });

    const profile = await db
      .select({ status: profiles.status })
      .from(profiles)
      .where(eq(profiles.userId, res.user.id))
      .get();
    if (profile?.status !== "active") {
      await db.delete(session).where(eq(session.token, res.token));
      return fail(profile?.status === "suspended" ? "suspended" : "pending");
    }
    return { ok: true, userId: res.user.id };
  } catch (error) {
    if (error instanceof APIError && error.statusCode === 401) return fail("invalid");
    return fail("failed");
  }
}
