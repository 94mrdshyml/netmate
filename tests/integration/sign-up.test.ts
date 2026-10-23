import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { ensureInviteLink, findActiveInvite } from "@/server/invites";
import { signUpWithInvite } from "@/server/sign-up";

const authEnv = () => ({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
const db = () => getDb(env.DB);

let counter = 0;
async function makeOwner(role: "admin" | "member") {
  const n = ++counter;
  const { user } = await createAuth(authEnv()).api.signUpEmail({
    body: { email: `owner${n}@example.com`, password: "a-long-enough-pass", name: "Owner Person" },
  });
  await db().insert(profiles).values({ userId: user.id, username: `owner_${n}`, firstName: "Owen", lastName: "Owner", role, status: "active" });
  return ensureInviteLink(db(), user.id);
}

function person(code: string, n: number, overrides: Record<string, unknown> = {}) {
  return {
    invite: code,
    firstName: "Pat",
    lastName: `Person${n}`,
    email: `pat${code.slice(0, 6)}${n}@example.com`.toLowerCase(),
    username: `pat_${code.slice(0, 5).toLowerCase()}_${n}`,
    password: "a-long-enough-pass",
    ...overrides,
  };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

describe("invite links", () => {
  it("gives a member one long random link and reuses it", async () => {
    const link = await makeOwner("member");
    expect(link.code).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(await ensureInviteLink(db(), link.ownerUserId)).toEqual(link);
    expect(await findActiveInvite(db(), link.code)).toMatchObject({ id: link.id, ownerUserId: link.ownerUserId, ownerName: "Owen Owner" });
  });

  it("does not find unknown, malformed or revoked codes", async () => {
    const link = await makeOwner("member");
    expect(await findActiveInvite(db(), "x".repeat(32))).toBeNull();
    expect(await findActiveInvite(db(), "short")).toBeNull();
    expect(await findActiveInvite(db(), undefined)).toBeNull();

    await env.DB.prepare("update invite_links set revoked_at = 1 where id = ?").bind(link.id).run();
    expect(await findActiveInvite(db(), link.code)).toBeNull();
  });
});

describe("sign-up through a member link", () => {
  it("approves the first 5 and makes the 6th and 7th Pending, in order", async () => {
    const link = await makeOwner("member");
    const outcomes: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const res = await signUpWithInvite(authEnv(), person(link.code, i));
      expect(res.ok).toBe(true);
      if (res.ok) outcomes.push(res.status);
    }
    expect(outcomes).toEqual(["active", "active", "active", "active", "active", "pending", "pending"]);
    expect(await count("select uses_count as n from invite_links where id = ?", link.id)).toBe(7);
    expect(await count("select count(*) as n from invite_uses where invite_link_id = ? and outcome = 'pending'", link.id)).toBe(2);
  });

  it("gets the right outcomes when 8 people use the link at the same moment", async () => {
    const link = await makeOwner("member");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => signUpWithInvite(authEnv(), person(link.code, i))));

    expect(results.every((r) => r.ok)).toBe(true);
    const active = results.filter((r) => r.ok && r.status === "active").length;
    expect(active).toBe(5);
    expect(await count("select count(*) as n from profiles where invited_by = ? and status = 'pending'", link.ownerUserId)).toBe(3);
    expect(await count("select uses_count as n from invite_links where id = ?", link.id)).toBe(8);
  });

  it("never limits the admin's link", async () => {
    const link = await makeOwner("admin");
    for (let i = 1; i <= 8; i++) {
      const res = await signUpWithInvite(authEnv(), person(link.code, i));
      expect(res).toMatchObject({ ok: true, status: "active" });
    }
  });

  it("records who invited each person and creates a normal member", async () => {
    const link = await makeOwner("member");
    const res = await signUpWithInvite(authEnv(), person(link.code, 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await env.DB.prepare("select role, status, invited_by, username from profiles where user_id = ?")
      .bind(res.userId)
      .first<{ role: string; status: string; invited_by: string; username: string }>();
    expect(row).toMatchObject({ role: "member", status: "active", invited_by: link.ownerUserId });
    expect(res.userId).toMatch(/^usr_[0-9A-Za-z]{24}$/);
  });

  it("lets an approved person sign in, and keeps a Pending person out", async () => {
    const link = await makeOwner("member");
    const people = [];
    for (let i = 1; i <= 6; i++) people.push(person(link.code, i));
    for (const p of people) await signUpWithInvite(authEnv(), p);

    const auth = createAuth(authEnv());
    expect(await signInMember(auth, db(), { email: people[0]!.email, password: "a-long-enough-pass" })).toMatchObject({ ok: true });
    expect(await signInMember(auth, db(), { email: people[5]!.email, password: "a-long-enough-pass" })).toMatchObject({
      ok: false,
      code: "pending",
    });
  });

  it("stores a hash, never the password, and leaves no session behind", async () => {
    const link = await makeOwner("member");
    const res = await signUpWithInvite(authEnv(), person(link.code, 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const account = await env.DB.prepare("select password from account where user_id = ?").bind(res.userId).first<{ password: string }>();
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain("a-long-enough-pass");
    expect(await count("select count(*) as n from session where user_id = ?", res.userId)).toBe(0);
  });
});

describe("sign-up refusals", () => {
  it("refuses a revoked link and writes nothing", async () => {
    const link = await makeOwner("member");
    await env.DB.prepare("update invite_links set revoked_at = 1 where id = ?").bind(link.id).run();
    const before = await count("select count(*) as n from user");

    const res = await signUpWithInvite(authEnv(), person(link.code, 1));

    expect(res).toMatchObject({ ok: false, code: "invite_invalid" });
    expect(await count("select count(*) as n from user")).toBe(before);
  });

  it("refuses an unknown link", async () => {
    expect(await signUpWithInvite(authEnv(), person("y".repeat(32), 1))).toMatchObject({ ok: false, code: "invite_invalid" });
  });

  it("refuses a link whose owner is not an active member", async () => {
    const link = await makeOwner("member");
    await env.DB.prepare("update profiles set status = 'pending' where user_id = ?").bind(link.ownerUserId).run();
    expect(await signUpWithInvite(authEnv(), person(link.code, 1))).toMatchObject({ ok: false, code: "invite_invalid" });
  });

  it("reports every invalid field at once", async () => {
    const link = await makeOwner("member");
    const res = await signUpWithInvite(authEnv(), { invite: link.code, firstName: "", lastName: "", email: "nope", username: "a", password: "short" });
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (res.ok || !res.fieldErrors) throw new Error("expected field errors");
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["email", "firstName", "lastName", "password", "username"]);
  });

  it.each(["admin", "setup", "netmate"])("refuses the reserved username %s", async (username) => {
    const link = await makeOwner("member");
    const res = await signUpWithInvite(authEnv(), person(link.code, 1, { username }));
    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { username: "That username is reserved" } });
  });

  it("refuses a taken email (ignoring case) and rolls everything back", async () => {
    const link = await makeOwner("member");
    expect((await signUpWithInvite(authEnv(), person(link.code, 1, { email: "same@example.com" }))).ok).toBe(true);
    const uses = await count("select uses_count as n from invite_links where id = ?", link.id);

    const res = await signUpWithInvite(authEnv(), person(link.code, 2, { email: "SAME@example.com" }));

    expect(res).toMatchObject({ ok: false, code: "email_taken" });
    expect(await count("select uses_count as n from invite_links where id = ?", link.id)).toBe(uses);
  });

  it("refuses a taken username (ignoring case) and leaves no half-made account", async () => {
    const link = await makeOwner("member");
    expect((await signUpWithInvite(authEnv(), person(link.code, 1, { username: "taken_name" }))).ok).toBe(true);
    const users = await count("select count(*) as n from user");

    const res = await signUpWithInvite(authEnv(), person(link.code, 2, { username: "Taken_Name" }));

    expect(res).toMatchObject({ ok: false, code: "username_taken" });
    expect(await count("select count(*) as n from user")).toBe(users);
  });
});
