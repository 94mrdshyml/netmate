import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { emailState, instanceSecrets, session, verification } from "@/db/schema";
import { fakeTransport, outbox } from "@/email/transport";
import { saveEmailSettings } from "@/server/email";
import { requestPasswordReset, resetEmailSender, resetPasswordWithToken, resetTokenIsLive } from "@/server/password-reset";
import { LIMITS, limitPasswordResetRequest, limitPasswordResetSubmit } from "@/server/rate-limit";

const db = () => getDb(env.DB);
const ENC = env.SETTINGS_ENCRYPTION_KEY!;
const SALT = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
const authEnv = () => ({ DB: env.DB, AUTH_SECRET: SALT });
const mail = { transport: fakeTransport, encryptionKey: ENC, origin: "https://club.example.org" };
const OLD = "the-old-password-1";
const NEW = "a-brand-new-password-2";

// One auth object that really sends the reset email through the fake outbox.
const auth = () => createAuth(authEnv(), { sendResetPassword: resetEmailSender(db(), mail) });

let counter = 0;
async function makeMember(name = "Ines Test") {
  const n = ++counter;
  const email = `reset${n}@example.com`;
  const { user } = await createAuth(authEnv()).api.signUpEmail({ body: { email, password: OLD, name } });
  return { id: user.id, email };
}

async function setUpEmail() {
  expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "re_test_abcdefghijklmnop", from: "hello@example.org" })).toEqual({ ok: true });
}

/** The token from the link in the most recent email. */
function tokenFromOutbox(): string {
  const href = /href="https:\/\/club\.example\.org\/reset-password\?token=([^"]+)"/.exec(outbox.at(-1)?.html ?? "");
  if (!href) throw new Error("no reset link in the last email");
  return decodeURIComponent(href[1]!);
}

beforeEach(async () => {
  outbox.length = 0;
  await db().delete(instanceSecrets);
  await db().delete(emailState);
});

describe("asking for a reset link", () => {
  it("emails a member a one-hour link to the reset page, greeting them by first name", async () => {
    await setUpEmail();
    const member = await makeMember("Ines Test");

    expect(await requestPasswordReset(auth(), db(), member.email)).toEqual({ ok: true });

    expect(outbox).toHaveLength(1);
    const mail1 = outbox[0]!;
    expect(mail1.to).toBe(member.email);
    expect(mail1.from).toBe("hello@example.org");
    expect(mail1.html).toContain("Hi Ines,");
    expect(mail1.html).toContain("60 minutes");
    expect(mail1.text).toMatch(/https:\/\/club\.example\.org\/reset-password\?token=/);
    expect(await resetTokenIsLive(db(), tokenFromOutbox())).toBe(true);
  });

  it("trims and lower-cases the address", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), `  ${member.email.toUpperCase()}  `);
    expect(outbox).toHaveLength(1);
  });

  it("answers the same for an address that is not a member, and sends nothing", async () => {
    await setUpEmail();
    const member = await makeMember();
    const known = await requestPasswordReset(auth(), db(), member.email);
    const unknown = await requestPasswordReset(auth(), db(), "nobody-here@example.org");
    expect(unknown).toEqual(known);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(member.email);
  });

  it.each([["nothing", ""], ["words", "not an address"], ["a number", 7], ["nothing at all", undefined]])("refuses %s", async (_label, value) => {
    await setUpEmail();
    expect(await requestPasswordReset(auth(), db(), value)).toMatchObject({ ok: false, code: "invalid" });
    expect(outbox).toHaveLength(0);
  });

  it("is not available without email, and makes no token", async () => {
    const member = await makeMember();
    expect(await requestPasswordReset(auth(), db(), member.email)).toMatchObject({ ok: false, code: "not_set_up" });
    expect(outbox).toHaveLength(0);
    expect(await db().select().from(verification).where(eq(verification.value, member.id))).toHaveLength(0);
  });

  it("does not fail when Resend refuses the email, and keeps the same answer", async () => {
    expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "re_test_abcdefghijklmnop", from: "hello@nowhere.invalid" })).toEqual({ ok: true });
    const member = await makeMember();
    expect(await requestPasswordReset(auth(), db(), member.email)).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
  });

  it("leaves no email address in what is stored for the link", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);
    const rows = await db().select().from(verification).where(eq(verification.value, member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).toBe(`reset-password:${tokenFromOutbox()}`);
    expect(JSON.stringify(rows)).not.toContain(member.email);
  });
});

describe("choosing a new password with the link", () => {
  it("changes the password: the new one signs in and the old one no longer does", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);

    expect(await resetPasswordWithToken(auth(), db(), { token: tokenFromOutbox(), password: NEW })).toEqual({ ok: true });

    await expect(createAuth(authEnv()).api.signInEmail({ body: { email: member.email, password: OLD } })).rejects.toBeTruthy();
    const ok = await createAuth(authEnv()).api.signInEmail({ body: { email: member.email, password: NEW } });
    expect(ok.user.id).toBe(member.id);
  });

  it("works once: a second use of the same link is refused", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);
    const token = tokenFromOutbox();

    expect(await resetPasswordWithToken(auth(), db(), { token, password: NEW })).toEqual({ ok: true });
    expect(await resetTokenIsLive(db(), token)).toBe(false);
    expect(await resetPasswordWithToken(auth(), db(), { token, password: "another-password-3" })).toMatchObject({ ok: false, code: "expired" });
    // The password from the first use stands.
    expect((await createAuth(authEnv()).api.signInEmail({ body: { email: member.email, password: NEW } })).user.id).toBe(member.id);
  });

  it("ends every other session", async () => {
    await setUpEmail();
    const member = await makeMember();
    await createAuth(authEnv()).api.signInEmail({ body: { email: member.email, password: OLD } });
    expect((await db().select().from(session).where(eq(session.userId, member.id))).length).toBeGreaterThan(0);

    await requestPasswordReset(auth(), db(), member.email);
    await resetPasswordWithToken(auth(), db(), { token: tokenFromOutbox(), password: NEW });

    expect(await db().select().from(session).where(eq(session.userId, member.id))).toHaveLength(0);
  });

  it("refuses a short or long password and leaves the link usable", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);
    const token = tokenFromOutbox();

    expect(await resetPasswordWithToken(auth(), db(), { token, password: "short" })).toMatchObject({ ok: false, code: "invalid", message: "Use at least 8 characters" });
    expect(await resetPasswordWithToken(auth(), db(), { token, password: "x".repeat(129) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await resetTokenIsLive(db(), token)).toBe(true);
    expect(await resetPasswordWithToken(auth(), db(), { token, password: NEW })).toEqual({ ok: true });
  });

  it.each([["unknown", "abcdefghijklmnopqrstuvwx"], ["too short", "abc"], ["too long", "x".repeat(101)], ["empty", ""], ["a number", 5], ["nothing", undefined]])(
    "refuses a %s token",
    async (_label, token) => {
      expect(await resetPasswordWithToken(auth(), db(), { token, password: NEW })).toMatchObject({ ok: false, code: "expired" });
      expect(await resetTokenIsLive(db(), token)).toBe(false);
    },
  );

  it("refuses a link that has run out", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);
    const token = tokenFromOutbox();
    await db().update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, `reset-password:${token}`));

    expect(await resetTokenIsLive(db(), token)).toBe(false);
    expect(await resetPasswordWithToken(auth(), db(), { token, password: NEW })).toMatchObject({ ok: false, code: "expired" });
    await expect(createAuth(authEnv()).api.signInEmail({ body: { email: member.email, password: NEW } })).rejects.toBeTruthy();
  });

  it("two people at once cannot both use one link", async () => {
    await setUpEmail();
    const member = await makeMember();
    await requestPasswordReset(auth(), db(), member.email);
    const token = tokenFromOutbox();
    const results = await Promise.all([
      resetPasswordWithToken(auth(), db(), { token, password: "first-choice-password" }),
      resetPasswordWithToken(auth(), db(), { token, password: "second-choice-password" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("limits", () => {
  it("allows five links an hour to one address, whoever asks", async () => {
    const email = `limited-${Date.now()}@example.org`;
    for (let i = 0; i < LIMITS.resetEmail.max; i++) {
      expect(await limitPasswordResetRequest(env.DB, SALT, { ip: `10.0.0.${i}`, email })).toEqual({ ok: true });
    }
    expect(await limitPasswordResetRequest(env.DB, SALT, { ip: "10.0.1.1", email })).toMatchObject({ ok: false });
  });

  it("allows twenty requests an hour from one visitor", async () => {
    const ip = `10.9.${Date.now() % 250}.1`;
    for (let i = 0; i < LIMITS.resetIp.max; i++) {
      expect(await limitPasswordResetRequest(env.DB, SALT, { ip, email: `many${i}-${Date.now()}@example.org` })).toEqual({ ok: true });
    }
    expect(await limitPasswordResetRequest(env.DB, SALT, { ip, email: `last-${Date.now()}@example.org` })).toMatchObject({ ok: false });
  });

  it("allows ten tries with a link per ten minutes from one visitor", async () => {
    const ip = `10.8.${Date.now() % 250}.2`;
    for (let i = 0; i < LIMITS.resetSubmit.max; i++) expect(await limitPasswordResetSubmit(env.DB, SALT, ip)).toEqual({ ok: true });
    expect(await limitPasswordResetSubmit(env.DB, SALT, ip)).toMatchObject({ ok: false });
  });

  it("keeps no address or visitor address in the limit keys", async () => {
    const email = `private-${Date.now()}@example.org`;
    await limitPasswordResetRequest(env.DB, SALT, { ip: "203.0.113.77", email });
    const keys = (await env.DB.prepare("select key from rate_hits where key like 'reset:%'").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes("@") || k.includes("203.0.113.77") || k.includes(email))).toBe(false);
  });
});
