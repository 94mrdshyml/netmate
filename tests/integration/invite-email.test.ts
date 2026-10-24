import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { emailState, instanceSecrets, profiles } from "@/db/schema";
import { fakeTransport, outbox } from "@/email/transport";
import { emailPanel, saveEmailSettings } from "@/server/email";
import { sendInviteEmail } from "@/server/invite-email";
import { ensureInviteLink } from "@/server/invites";
import { LIMITS } from "@/server/rate-limit";

const db = () => getDb(env.DB);
const ENC = env.SETTINGS_ENCRYPTION_KEY!;
const SALT = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
const authEnv = () => ({ DB: env.DB, AUTH_SECRET: SALT });
const ctx = { transport: fakeTransport, encryptionKey: ENC, origin: "https://club.example.org", salt: SALT };

let counter = 0;
let adminMade = false;

async function makeMember(first: string, role: "admin" | "member" = "member") {
  const n = ++counter;
  const email = `inviter${n}@example.com`;
  if (role === "admin") adminMade = true;
  const { user } = await createAuth(authEnv()).api.signUpEmail({ body: { email, password: "a-long-enough-pass", name: `${first} Test` } });
  await db().insert(profiles).values({ userId: user.id, username: `inviter_${n}`, firstName: first, lastName: "Test", role, status: "active" });
  const link = await ensureInviteLink(db(), user.id);
  return { inviter: { userId: user.id, name: `${first} Test`, email }, link };
}

let seq = 0;
const fresh = () => `friend${Date.now().toString(36)}${++seq}@example.org`;

async function setUpEmail(from = "hello@example.org") {
  expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "re_test_abcdefghijklmnop", from })).toEqual({ ok: true });
}

beforeEach(async () => {
  outbox.length = 0;
  await db().delete(instanceSecrets);
  await db().delete(emailState);
  if (!adminMade) await makeMember("Ada", "admin");
});

describe("inviting by email", () => {
  it("sends the invitation to the address, with the inviter's own link, in the instance's brand", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    const to = fresh();

    expect(await sendInviteEmail(db(), env.DB, ctx, inviter, link, to)).toEqual({ ok: true });

    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(to);
    expect(mail.from).toBe("hello@example.org");
    expect(mail.subject).toContain("Ines Test invited you to join");
    expect(mail.html).toContain("Ines Test invited you to join");
    // The link carries the invited address after the "#", so the sign-up form can fill it in (a browser never sends that part to us).
    const hint = `#email=${encodeURIComponent(to)}`;
    expect(mail.html).toContain(`href="https://club.example.org/sign-up?invite=${link.code}${hint}"`);
    expect(mail.text).toContain(`https://club.example.org/sign-up?invite=${link.code}${hint}`);
  });

  it("trims and lower-cases the address", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    const to = fresh();
    await sendInviteEmail(db(), env.DB, ctx, inviter, link, `  ${to.toUpperCase()}  `);
    expect(outbox[0]!.to).toBe(to);
  });

  it.each([["nothing", ""], ["words", "not an address"], ["two at signs", "a@@b.com"], ["a number", 42], ["nothing at all", undefined], ["too long", `${"a".repeat(250)}@example.org`]])(
    "refuses %s and sends nothing",
    async (_label, value) => {
      await setUpEmail();
      const { inviter, link } = await makeMember("Ines");
      const res = await sendInviteEmail(db(), env.DB, ctx, inviter, link, value);
      expect(res).toMatchObject({ ok: false, code: "invalid" });
      expect(outbox).toHaveLength(0);
    },
  );

  it("refuses the inviter's own address", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    expect(await sendInviteEmail(db(), env.DB, ctx, inviter, link, inviter.email.toUpperCase())).toMatchObject({ ok: false, code: "own" });
    expect(outbox).toHaveLength(0);
  });

  it("says so when email is not set up, and sends nothing", async () => {
    const { inviter, link } = await makeMember("Ines");
    const res = await sendInviteEmail(db(), env.DB, ctx, inviter, link, fresh());
    expect(res).toMatchObject({ ok: false, code: "not_set_up" });
    expect(outbox).toHaveLength(0);
  });

  it("does not email a person who already has an account, and answers as if it had", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    const other = await makeMember("Omar");
    expect(await sendInviteEmail(db(), env.DB, ctx, inviter, link, other.inviter.email)).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
  });

  it("leaves the invitation out when the site address is unknown", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    const res = await sendInviteEmail(db(), env.DB, { ...ctx, origin: undefined }, inviter, link, fresh());
    expect(res).toMatchObject({ ok: false, code: "failed" });
    expect(outbox).toHaveLength(0);
  });

  it("limits one member to ten invitations an hour, then says when to try again", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    for (let i = 0; i < LIMITS.inviteEmail.max; i++) {
      expect(await sendInviteEmail(db(), env.DB, ctx, inviter, link, fresh())).toEqual({ ok: true });
    }
    const res = await sendInviteEmail(db(), env.DB, ctx, inviter, link, fresh());
    expect(res).toMatchObject({ ok: false, code: "rate_limited" });
    expect((res as { message: string }).message).toMatch(/^Too many attempts\. Try again in \d+ minutes?\.$/);
    expect(outbox).toHaveLength(LIMITS.inviteEmail.max);
  });

  it("limits mail to one address to two a day, whoever sends it", async () => {
    await setUpEmail();
    const a = await makeMember("Ines");
    const b = await makeMember("Bao");
    const c = await makeMember("Cai");
    const to = fresh();
    expect(await sendInviteEmail(db(), env.DB, ctx, a.inviter, a.link, to)).toEqual({ ok: true });
    expect(await sendInviteEmail(db(), env.DB, ctx, b.inviter, b.link, to)).toEqual({ ok: true });
    expect(await sendInviteEmail(db(), env.DB, ctx, c.inviter, c.link, to)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(outbox).toHaveLength(2);
  });

  it("keeps no copy of the address: not in the limit keys, not in the recorded state", async () => {
    await setUpEmail("hello@nowhere.invalid");
    const { inviter, link } = await makeMember("Ines");
    const to = fresh();
    const res = await sendInviteEmail(db(), env.DB, ctx, inviter, link, to);
    expect(res).toMatchObject({ ok: false, code: "failed" });

    const keys = await env.DB.prepare("select key from rate_hits").all<{ key: string }>();
    expect(keys.results.some((r) => r.key.includes(to) || r.key.includes("@"))).toBe(false);
    const panel = await emailPanel(db(), ENC);
    expect(panel.lastError).toContain("not verified");
    expect(JSON.stringify(panel)).not.toContain(to);
  });

  it("a refused send says how to carry on and records Resend's reason for the admin", async () => {
    await setUpEmail("hello@nowhere.invalid");
    const { inviter, link } = await makeMember("Ines");
    const res = await sendInviteEmail(db(), env.DB, ctx, inviter, link, fresh());
    expect(res).toMatchObject({ ok: false, code: "failed", message: "Could not send that email. Try again later, or share your link by hand." });
    expect((await emailPanel(db(), ENC)).lastError).toContain("not verified");
  });

  it("escapes a hostile name and keeps line breaks out of the subject", async () => {
    await setUpEmail();
    const { inviter, link } = await makeMember("Ines");
    const injected = ["<", "b>x</b>"].join("");
    await sendInviteEmail(db(), env.DB, ctx, { ...inviter, name: `${injected}\r\nBcc: someone` }, link, fresh());
    const mail = outbox[0]!;
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain(injected);
    expect(mail.html).toContain("&lt;b&gt;");
  });
});
