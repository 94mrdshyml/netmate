import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { instance, profiles } from "@/db/schema";
import { readInstance } from "@/instance/settings";
import {
  approvePending,
  countMembers,
  countPending,
  listInviteLinks,
  listPending,
  regenerateInvite,
  rejectPending,
  setInviteQuota,
} from "@/server/admin";
import { ensureInviteLink, findActiveInvite } from "@/server/invites";
import { signUpWithInvite } from "@/server/sign-up";

const authEnv = () => ({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
const db = () => getDb(env.DB);
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

let counter = 0;
let adminLink: Awaited<ReturnType<typeof ensureInviteLink>> | null = null;

/** There is exactly one admin per instance (a database rule), so every "admin" is the same person. */
async function makeOwner(role: "admin" | "member", first = "Owen") {
  if (role === "admin" && adminLink) return adminLink;
  const n = ++counter;
  const { user } = await createAuth(authEnv()).api.signUpEmail({
    body: { email: `hqowner${n}@example.com`, password: "a-long-enough-pass", name: `${first} Owner` },
  });
  await db().insert(profiles).values({ userId: user.id, username: `hqowner_${n}`, firstName: first, lastName: "Owner", role, status: "active" });
  const link = await ensureInviteLink(db(), user.id);
  if (role === "admin") adminLink = link;
  return link;
}

function person(code: string, n: number) {
  return {
    invite: code,
    firstName: "Pat",
    lastName: `Person${n}`,
    email: `hqpat${code.slice(0, 6)}${n}@example.com`.toLowerCase(),
    username: `hq_${code.slice(0, 5).toLowerCase()}_${n}`,
    password: "a-long-enough-pass",
  };
}

/** A Pending person, made by pushing their link past its quota first. */
async function pendingPerson() {
  const link = await makeOwner("member");
  const first = person(link.code, 1);
  await env.DB.prepare("update invite_links set uses_count = 99 where id = ?").bind(link.id).run();
  const res = await signUpWithInvite(authEnv(), first);
  if (!res.ok || res.status !== "pending") throw new Error("expected a pending sign-up");
  return { link, userId: res.userId, email: first.email, username: first.username };
}

describe("approvals", () => {
  it("lists Pending people oldest first with who invited them, and never active members", async () => {
    const a = await pendingPerson();
    await new Promise((r) => setTimeout(r, 5));
    const b = await pendingPerson();

    const list = await listPending(db());
    const ids = list.map((p) => p.userId);
    expect(ids.indexOf(a.userId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(a.userId)).toBeLessThan(ids.indexOf(b.userId));
    expect(list.find((p) => p.userId === a.userId)).toMatchObject({
      name: "Pat Person1",
      username: a.username,
      email: a.email,
      invitedByName: "Owen Owner",
    });
    expect(list.some((p) => p.userId === a.link.ownerUserId)).toBe(false);
  });

  it("approves a Pending person, who can then be found as an active member; a repeat changes nothing", async () => {
    const p = await pendingPerson();
    const pendingBefore = await countPending(db());
    const membersBefore = await countMembers(db());

    expect(await approvePending(db(), p.userId)).toEqual({ ok: true });

    expect(await count("select count(*) as n from profiles where user_id = ? and status = 'active'", p.userId)).toBe(1);
    expect(await countPending(db())).toBe(pendingBefore - 1);
    expect(await countMembers(db())).toBe(membersBefore + 1);
    expect(await approvePending(db(), p.userId)).toEqual({ ok: false, code: "not_pending" });
  });

  it("will not approve an unknown id, or touch an active member", async () => {
    const owner = await makeOwner("member");
    expect(await approvePending(db(), "usr_" + "z".repeat(24))).toEqual({ ok: false, code: "not_pending" });
    expect(await approvePending(db(), owner.ownerUserId)).toEqual({ ok: false, code: "not_pending" });
  });

  it("rejects a Pending person by deleting the account, so the email and username are free again", async () => {
    const p = await pendingPerson();

    expect(await rejectPending(db(), p.userId)).toEqual({ ok: true });

    expect(await count("select count(*) as n from user where id = ?", p.userId)).toBe(0);
    expect(await count("select count(*) as n from profiles where user_id = ?", p.userId)).toBe(0);
    expect(await count("select count(*) as n from account where user_id = ?", p.userId)).toBe(0);
    expect(await count("select count(*) as n from invite_uses where user_id = ?", p.userId)).toBe(0);

    // The same email and username can sign up again through another live link.
    const again = await signUpWithInvite(authEnv(), { ...person((await makeOwner("admin")).code, 1), email: p.email, username: p.username });
    expect(again).toMatchObject({ ok: true });
  });

  it("does not give a rejected person's slot back", async () => {
    const p = await pendingPerson();
    await rejectPending(db(), p.userId);
    expect(await count("select uses_count as n from invite_links where id = ?", p.link.id)).toBe(100);
  });

  it("refuses to reject an active member or the admin, and changes nothing", async () => {
    const member = await makeOwner("member");
    const admin = await makeOwner("admin");

    expect(await rejectPending(db(), member.ownerUserId)).toEqual({ ok: false, code: "not_pending" });
    expect(await rejectPending(db(), admin.ownerUserId)).toEqual({ ok: false, code: "not_pending" });
    expect(await rejectPending(db(), "usr_" + "y".repeat(24))).toEqual({ ok: false, code: "not_pending" });

    expect(await count("select count(*) as n from profiles where user_id in (?, ?)", member.ownerUserId, admin.ownerUserId)).toBe(2);
  });
});

describe("regenerating an invite link", () => {
  it("replaces the code: the old one stops working at once and the new one works", async () => {
    const link = await makeOwner("member");

    expect(await regenerateInvite(db(), env.DB, link.id)).toEqual({ ok: true });

    expect(await findActiveInvite(db(), link.code)).toBeNull();
    const next = await ensureInviteLink(db(), link.ownerUserId);
    expect(next.id).not.toBe(link.id);
    expect(next.code).not.toBe(link.code);
    expect(next.code).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(await findActiveInvite(db(), next.code)).toMatchObject({ ownerUserId: link.ownerUserId });
    expect(await count("select count(*) as n from invite_links where owner_user_id = ? and revoked_at is null", link.ownerUserId)).toBe(1);
  });

  it("carries the sign-up count over, so a new link is not a fresh quota", async () => {
    const link = await makeOwner("member");
    for (let i = 1; i <= 3; i++) await signUpWithInvite(authEnv(), person(link.code, i));

    await regenerateInvite(db(), env.DB, link.id);

    const next = await ensureInviteLink(db(), link.ownerUserId);
    expect(await count("select uses_count as n from invite_links where id = ?", next.id)).toBe(3);

    // Three already used out of five: two more are approved, then the next waits.
    const statuses: string[] = [];
    for (let i = 4; i <= 6; i++) {
      const res = await signUpWithInvite(authEnv(), person(next.code, i));
      if (res.ok) statuses.push(res.status);
    }
    expect(statuses).toEqual(["active", "active", "pending"]);
  });

  it("leaves people who already joined through the old link alone", async () => {
    const link = await makeOwner("member");
    const res = await signUpWithInvite(authEnv(), person(link.code, 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    await regenerateInvite(db(), env.DB, link.id);

    expect(await count("select count(*) as n from profiles where user_id = ? and status = 'active'", res.userId)).toBe(1);
  });

  it("makes only one new link when two admins click at the same moment", async () => {
    const link = await makeOwner("member");

    const results = await Promise.all([regenerateInvite(db(), env.DB, link.id), regenerateInvite(db(), env.DB, link.id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await count("select count(*) as n from invite_links where owner_user_id = ? and revoked_at is null", link.ownerUserId)).toBe(1);
  });

  it("refuses an unknown or already replaced link", async () => {
    const link = await makeOwner("member");
    expect(await regenerateInvite(db(), env.DB, "inv_" + "q".repeat(24))).toEqual({ ok: false, code: "not_found" });
    await regenerateInvite(db(), env.DB, link.id);
    expect(await regenerateInvite(db(), env.DB, link.id)).toEqual({ ok: false, code: "not_found" });
  });

  it("lists active links with the admin first and shows each count", async () => {
    const member = await makeOwner("member", "Zed");
    await signUpWithInvite(authEnv(), person(member.code, 1));
    await regenerateInvite(db(), env.DB, member.id);

    const links = await listInviteLinks(db());
    const mine = links.find((l) => l.ownerUserId === member.ownerUserId);
    expect(mine).toMatchObject({ usesCount: 1, isAdmin: false, ownerName: "Zed Owner" });
    expect(mine?.code).not.toBe(member.code);
    expect(links.filter((l) => l.ownerUserId === member.ownerUserId)).toHaveLength(1);
    const firstMember = links.findIndex((l) => !l.isAdmin);
    expect(links.slice(firstMember).every((l) => !l.isAdmin)).toBe(true);
  });
});

describe("the invite quota setting", () => {
  async function ensureInstance() {
    await db()
      .insert(instance)
      .values({ id: "singleton", name: "Test", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" })
      .onConflictDoNothing();
  }

  it.each([["0", 0], ["5", 5], [" 12 ", 12], ["1000", 1000], [7, 7]])("accepts %j", async (input, expected) => {
    await ensureInstance();
    expect(await setInviteQuota(db(), input)).toEqual({ ok: true, quota: expected });
    expect((await readInstance(db())).settings.inviteQuota).toBe(expected);
  });

  it.each([["-1"], ["1001"], ["2.5"], [""], ["abc"], ["1e3"], [null], [undefined], [1.5], [-3], [{}]])("refuses %j and keeps the old value", async (input) => {
    await ensureInstance();
    await setInviteQuota(db(), "9");
    const res = await setInviteQuota(db(), input);
    expect(res).toMatchObject({ ok: false });
    expect((await readInstance(db())).settings.inviteQuota).toBe(9);
  });

  it("changes how many sign-ups a member link approves", async () => {
    await ensureInstance();
    await setInviteQuota(db(), "2");
    const link = await makeOwner("member");
    const statuses: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const res = await signUpWithInvite(authEnv(), person(link.code, i));
      if (res.ok) statuses.push(res.status);
    }
    expect(statuses).toEqual(["active", "active", "pending", "pending"]);
    await setInviteQuota(db(), "5");
  });
});
