// The signed-in member for the current request. Every page and action calls this itself
// (CLAUDE.md hard rule 5); nothing trusts a user id from the client.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { createNextAuth } from "@/auth/next";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";

export type Member = {
  userId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarKey: string | null;
  role: "admin" | "member";
};

/** The active member behind this request's session cookie, or null. A Pending account is never a member. */
export async function getMember(): Promise<Member | null> {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createNextAuth({ DB: env.DB, AUTH_SECRET: env.AUTH_SECRET, BETTER_AUTH_URL: env.BETTER_AUTH_URL });

  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) return null;

  const profile = await getDb(env.DB).select().from(profiles).where(eq(profiles.userId, current.user.id)).get();
  if (!profile || profile.status !== "active") return null;

  return {
    userId: profile.userId,
    email: current.user.email,
    username: profile.username,
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarKey: profile.avatarKey,
    role: profile.role as Member["role"],
  };
}
