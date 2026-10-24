import { z } from "zod";

// A person invited by email arrives on the sign-up form with their address already in the Email box. The address
// travels in the part of the link after the "#", which a browser never sends to the server, so it is not in any
// request, log or database row (CLAUDE.md rule 2). It is only a convenience: the box can be changed, and the
// address is checked again, and verified by email when email is set up, exactly as if it had been typed.

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** The address in a link's "#email=..." part, or null when there is none or it is not an address. */
export function emailFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const parsed = emailSchema.safeParse(params.get("email") ?? "");
  return parsed.success ? parsed.data : null;
}

/** The link with the invited person's address added after the "#", so the sign-up form can fill it in. */
export function withEmailHint(url: string, email: string): string {
  return `${url}#email=${encodeURIComponent(email)}`;
}
