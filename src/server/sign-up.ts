// Sign-up through an invite link (docs/PRD.md sections 6 and 8.1).
// The quota check and the new account's status are decided inside one D1 batch, so two people
// taking slots N and N+1 at the same moment get the right outcomes (D1 runs a batch alone).

import { z } from "zod";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { readInstance } from "@/instance/settings";
import { newId } from "@/lib/ids";
import { validateUsername } from "@/lib/username";
import { findActiveInvite } from "@/server/invites";

export type SignUpEnv = { DB: D1Database; AUTH_SECRET: string; BETTER_AUTH_URL?: string };

const signUpSchema = z.object({
  invite: z.string(),
  firstName: z.string().trim().min(1, "Enter your first name").max(50, "Use 50 characters or fewer"),
  lastName: z.string().trim().min(1, "Enter your last name").max(50, "Use 50 characters or fewer"),
  email: z.string().trim().toLowerCase().max(254, "That email is too long").pipe(z.email("Enter a valid email address")),
  username: z.string(),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use 128 characters or fewer"),
});

export type SignUpFailure = "invalid" | "invite_invalid" | "email_taken" | "username_taken" | "failed";

export type SignUpResult =
  | { ok: true; userId: string; email: string; status: "active" | "pending" }
  | { ok: false; code: SignUpFailure; message: string; fieldErrors?: Record<string, string> };

const fail = (code: SignUpFailure, message: string, fieldErrors?: Record<string, string>): SignUpResult => ({
  ok: false,
  code,
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const USERNAME_MESSAGES = {
  length: "Use 3 to 15 characters",
  characters: "Use only letters, numbers and underscores",
  reserved: "That username is reserved",
} as const;

export async function signUpWithInvite(env: SignUpEnv, rawInput: unknown): Promise<SignUpResult> {
  const db = getDb(env.DB);
  const input = (rawInput ?? {}) as Record<string, unknown>;

  // 1. The link must be live before anything else is looked at.
  const invite = await findActiveInvite(db, input.invite);
  if (!invite) return fail("invite_invalid", "This invite link is not valid. Ask the person who sent it for a new one.");

  const { settings } = await readInstance(db);

  // 2. Validate every field and report all problems at once.
  const parsed = signUpSchema.safeParse(input);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }
  const username = validateUsername(typeof input.username === "string" ? input.username : "", {
    instanceName: settings.name,
  });
  if (!username.ok) errors.username = USERNAME_MESSAGES[username.reason];
  if (!parsed.success || !username.ok || Object.keys(errors).length > 0) {
    return fail("invalid", "Some answers need fixing.", errors);
  }
  const data = parsed.data;

  // 3. Prepare the slow part (password hash) before the quick atomic write.
  const auth = createAuth(env);
  const passwordHash = await (await auth.$context).password.hash(data.password);
  const userId = newId("user");
  const now = Date.now();

  // Every statement carries the same guard, so a link revoked a moment ago writes nothing at all.
  const live = "exists (select 1 from invite_links where id = ?1 and revoked_at is null)";
  const statements = [
    env.DB.prepare(
      `insert into user (id, name, email, email_verified, created_at, updated_at)
       select ?2, ?3, ?4, 0, ?5, ?5 where ${live}`,
    ).bind(invite.id, userId, `${data.firstName} ${data.lastName}`, data.email, now),
    env.DB.prepare(
      `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       select ?2, ?3, 'credential', ?3, ?4, ?5, ?5 where ${live}`,
    ).bind(invite.id, newId("account"), userId, passwordHash, now),
    // Status is decided here, before this person is counted: the admin's link is unlimited,
    // any other link auto-approves while its count is below the quota.
    env.DB.prepare(
      `insert into profiles (user_id, username, first_name, last_name, role, status, invited_by, created_at)
       select ?2, ?3, ?4, ?5, 'member',
         case
           when (select role from profiles where user_id = ?6) = 'admin' then 'active'
           when (select uses_count from invite_links where id = ?1) < ?7 then 'active'
           else 'pending'
         end,
         ?6, ?8
       where ${live}`,
    ).bind(invite.id, userId, username.username, data.firstName, data.lastName, invite.ownerUserId, settings.inviteQuota, now),
    env.DB.prepare(
      `insert into invite_uses (id, invite_link_id, user_id, outcome, created_at)
       select ?2, ?1, ?3, (select case status when 'active' then 'approved' else 'pending' end from profiles where user_id = ?3), ?4 where ${live}`,
    ).bind(invite.id, newId("inviteUse"), userId, now),
    env.DB.prepare("update invite_links set uses_count = uses_count + 1 where id = ?1 and revoked_at is null").bind(invite.id),
  ];

  try {
    const results = await env.DB.batch(statements);
    if ((results[4]?.meta.changes ?? 0) === 0) {
      return fail("invite_invalid", "This invite link is not valid. Ask the person who sent it for a new one.");
    }
  } catch (err) {
    const text = String((err as { cause?: { message?: string } })?.cause?.message ?? (err as Error)?.message ?? "");
    if (/user\.email/i.test(text)) return fail("email_taken", "That email is already in use.", { email: "That email is already in use" });
    if (/profiles\.username/i.test(text)) {
      return fail("username_taken", "That username is taken.", { username: "That username is taken" });
    }
    // Do not echo the database error: it can name columns and values.
    return fail("failed", "Could not create your account. Nothing was saved. Try again.");
  }

  const profile = await env.DB.prepare("select status from profiles where user_id = ?").bind(userId).first<{ status: "active" | "pending" }>();
  return { ok: true, userId, email: data.email, status: profile?.status ?? "pending" };
}
