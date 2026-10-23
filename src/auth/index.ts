import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { isIdModel, newId } from "@/lib/ids";

export type AuthEnv = {
  DB: D1Database;
  AUTH_SECRET: string;
  /** Public URL of the instance. Falls back to the request origin when unset. */
  BETTER_AUTH_URL?: string;
};

export type CreateAuthOptions = {
  plugins?: BetterAuthPlugin[];
  /** Sends the reset link. Without it, "forgot password" is switched off. */
  sendResetPassword?: (data: { user: { email: string; name: string }; token: string }) => Promise<void>;
  /** Runs work after the response (on Workers, `waitUntil`), so a known and an unknown email take about the same time. */
  background?: (promise: Promise<unknown>) => void;
};

/** How long a reset link works, in seconds. */
export const RESET_LINK_SECONDS = 3600;

/** Built per request: bindings only exist inside a request on Workers. */
export function createAuth(env: AuthEnv, options: CreateAuthOptions = {}) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      // A reset ends every other session, so a stolen session does not survive a new password.
      revokeSessionsOnPasswordReset: true,
      ...(options.sendResetPassword ? { sendResetPassword: ({ user, token }) => options.sendResetPassword!({ user, token }) } : {}),
    },
    plugins: options.plugins ?? [],
    // Stripe-style ids such as usr_... made in code (docs/PRD.md section 10).
    advanced: {
      database: {
        generateId: ({ model }) => {
          if (!isIdModel(model)) {
            throw new Error(`No id prefix registered for "${model}". Add it to src/lib/ids.ts.`);
          }
          return newId(model);
        },
      },
      ipAddress: { disableIpTracking: true },
      ...(options.background ? { backgroundTasks: { handler: options.background } } : {}),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
