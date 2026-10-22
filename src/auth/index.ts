import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export type AuthEnv = {
  DB: D1Database;
  AUTH_SECRET: string;
  /** Public URL of the instance. Falls back to the request origin when unset. */
  BETTER_AUTH_URL?: string;
};

/** Built per request: bindings only exist inside a request on Workers. */
export function createAuth(env: AuthEnv) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    // Ids are UUID strings made in code (docs/PRD.md section 10).
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { disableIpTracking: true },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
