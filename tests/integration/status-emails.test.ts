import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { emailState, instanceSecrets, profiles } from "@/db/schema";
import { fakeTransport, outbox } from "@/email/transport";
import { approvePending, rejectPending } from "@/server/admin";
import { emailPanel, saveEmailSettings } from "@/server/email";
import { ensureInviteLink } from "@/server/invites";
import { signUpWithInvite } from "@/server/sign-up";
import { emailAdminOfPending, emailApproved, emailRejected, pendingContact, type MailContext } from "@/server/status-emails";

const db = () => getDb(env.DB);
const ENC = env.SETTINGS_ENCRYPTION_KEY!;
const authEnv = () => ({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
const ctx: MailContext = { transport: fakeTransport, encryptionKey: ENC, origin: "https://club.example.org" };

let counter = 0;
let admin: { userId: string; email: string } | null = null;
let memberLink: Awaited<ReturnType<typeof ensureInviteLink>> | null = null;

/** One admin per instance (a database rule), so the same admin serves every test. */
async function ensureAdmin() {
  if (admin) return admin;
  const email = "statusadmin@example.com";
  const { user } = await createAuth(authEnv()).api.signUpEmail({ body: { email, password: "a-long-enough-pass", name: "Ada Admin" } });
  await db().insert(profiles).values({ userId: user.id, username: "status_admin", firstName: "Ada", lastName: "Admin", role: "admin", status: "active" });
  admin = { userId: user.id, email };
  return admin;
}

async function ensureMemberLink() {
  if (memberLink) return memberLink;
  await ensureAdmin();
  const n = ++counter;
  const { user } = await createAuth(authEnv()).api.signUpEmail({
    body: { email: `statusowner${n}@example.com`, password: "a-long-enough-pass", name: "Owen Owner" },
  });
  await db().insert(profiles).values({ userId: user.id, username: `status_owner_${n}`, firstName: "Owen", lastName: "Owner", role: "member", status: "active" });
  memberLink = await ensureInviteLink(db(), user.id);
  return memberLink;
}

/** A Pending sign-up, made by pushing the member's link past its quota first. */
async function pendingPerson(overrides: { firstName?: string; lastName?: string } = {}) {
  const link = await ensureMemberLink();
  const n = ++counter;
  await env.DB.prepare("update invite_links set uses_count = 99 where id = ?").bind(link.id).run();
  const input = {
    invite: link.code,
    firstName: overrides.firstName ?? "Pat",
    lastName: overrides.lastName ?? `Person${n}`,
    email: `statuspat${n}@example.com`,
    username: `status_pat_${n}`,
    password: "a-long-enough-pass",
  };
  const res = await signUpWithInvite(authEnv(), input);
  if (!res.ok || res.status !== "pending") throw new Error("expected a pending sign-up");
  return { userId: res.userId, ...input };
}

async function setUpEmail(from = "hello@example.org") {
  expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "re_test_abcdefghijklmnop", from })).toEqual({ ok: true });
}

beforeEach(async () => {
  outbox.length = 0;
  await db().delete(instanceSecrets);
  await db().delete(emailState);
});

describe("the admin hears about a Pending sign-up", () => {
  it("gets one branded email naming the person, who invited them, and a link to the approvals", async () => {
    const adminRow = await ensureAdmin();
    await setUpEmail();
    const p = await pendingPerson({ firstName: "Grace", lastName: "Hopper" });

    await emailAdminOfPending(db(), ctx, p.userId);

    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(adminRow.email);
    expect(mail.from).toBe("hello@example.org");
    expect(mail.subject).toContain("Grace Hopper");
    expect(mail.html).toContain("Grace Hopper");
    expect(mail.html).toContain(`@${p.username}`);
    expect(mail.html).toContain("Owen Owner");
    expect(mail.html).toContain('href="https://club.example.org/hq/approvals"');
    expect(mail.text).toContain("https://club.example.org/hq/approvals");
    // The applicant's own address is not given to anyone.
    expect(mail.html).not.toContain(p.email);
    expect(mail.text).not.toContain(p.email);
  });

  it("sends nothing, and does not fail, when email is not set up", async () => {
    const p = await pendingPerson();
    await expect(emailAdminOfPending(db(), ctx, p.userId)).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
    expect((await emailPanel(db(), ENC)).state).toBe("not_set_up");
  });

  it("sends nothing for someone who is not Pending, or does not exist", async () => {
    const adminRow = await ensureAdmin();
    await setUpEmail();
    await emailAdminOfPending(db(), ctx, adminRow.userId);
    await emailAdminOfPending(db(), ctx, "usr_" + "z".repeat(24));
    expect(outbox).toHaveLength(0);
  });

  it("leaves the button out when the site address is unknown", async () => {
    await ensureAdmin();
    await setUpEmail();
    const p = await pendingPerson();
    await emailAdminOfPending(db(), { ...ctx, origin: undefined }, p.userId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.html).not.toMatch(/<a [^>]*href/i);
  });

  it("keeps a hostile name out of the markup and out of the subject's line breaks", async () => {
    await ensureAdmin();
    await setUpEmail();
    const injected = ["<", "b>x</b>"].join("");
    const p = await pendingPerson({ firstName: `${injected}\r\nBcc: someone`, lastName: "Smith" });
    await emailAdminOfPending(db(), ctx, p.userId);
    const mail = outbox[0]!;
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain(injected);
    expect(mail.html).toContain("&lt;b&gt;");
  });

  it("records a failed send for /hq/email and still returns", async () => {
    await ensureAdmin();
    await setUpEmail("hello@nowhere.invalid");
    const p = await pendingPerson();
    await expect(emailAdminOfPending(db(), ctx, p.userId)).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
    const panel = await emailPanel(db(), ENC);
    expect(panel.lastError).toContain("not verified");
    expect(panel.lastError).not.toContain("@");
  });
});

describe("the person hears the answer", () => {
  it("reads the address only while they are Pending", async () => {
    const p = await pendingPerson();
    expect(await pendingContact(db(), p.userId)).toEqual({ email: p.email, firstName: "Pat" });
    await approvePending(db(), p.userId);
    expect(await pendingContact(db(), p.userId)).toBeNull();
    expect(await pendingContact(db(), "usr_" + "q".repeat(24))).toBeNull();
    const adminRow = await ensureAdmin();
    expect(await pendingContact(db(), adminRow.userId)).toBeNull();
  });

  it("approval sends a welcome with a sign-in button to the person's own address", async () => {
    await setUpEmail();
    const p = await pendingPerson({ firstName: "Grace" });
    const contact = await pendingContact(db(), p.userId);
    expect(await approvePending(db(), p.userId)).toEqual({ ok: true });
    await emailApproved(db(), ctx, contact!);

    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(p.email);
    expect(mail.html).toContain("Hi Grace,");
    expect(mail.html).toContain("was approved");
    expect(mail.html).toContain('href="https://club.example.org/sign-in"');
  });

  it("rejection sends a polite no after the account is gone, using the address read beforehand", async () => {
    await setUpEmail();
    const p = await pendingPerson({ firstName: "Grace" });
    const contact = await pendingContact(db(), p.userId);
    expect(await rejectPending(db(), p.userId)).toEqual({ ok: true });
    expect(await pendingContact(db(), p.userId)).toBeNull();
    await emailRejected(db(), ctx, contact!);

    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(p.email);
    expect(mail.html).toContain("did not approve");
    expect(mail.html).not.toMatch(/<a [^>]*href/i);
  });

  it("sends nothing, and does not fail, when email is not set up", async () => {
    const p = await pendingPerson();
    const contact = await pendingContact(db(), p.userId);
    await expect(emailApproved(db(), ctx, contact!)).resolves.toBeUndefined();
    await expect(emailRejected(db(), ctx, contact!)).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
  });
});
