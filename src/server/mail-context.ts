// The three things any email send needs from the Worker's environment, gathered in one place.

import { transportFor } from "@/email/transport";
import type { MailContext } from "@/server/status-emails";

export function mailContext(env: { ENV?: string; SETTINGS_ENCRYPTION_KEY?: string; BETTER_AUTH_URL?: string }): MailContext {
  return { transport: transportFor(env), encryptionKey: env.SETTINGS_ENCRYPTION_KEY, origin: env.BETTER_AUTH_URL };
}
