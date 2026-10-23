import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";

function auth() {
  return createAuth({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
}

// Better Auth signs a new account in on sign-up; clear that so the tests count only sign-in sessions.
async function clearSessions(userId: string) {
  await env.DB.prepare("delete from session where user_id = ?").bind(userId).run();
}

async function makeMember(email: string, username: string, status: "active" | "pending", password = "a-long-enough-pass") {
  const { user } = await auth().api.signUpEmail({ body: { email, password, name: "Test Person" } });
  await clearSessions(user.id);
  await getDb(env.DB)
    .insert(profiles)
    .values({ userId: user.id, username, firstName: "Test", lastName: "Person", role: "member", status });
  return user.id;
}

const sessionCount = async (userId: string) =>
  (await env.DB.prepare("select count(*) as n from session where user_id = ?").bind(userId).first<{ n: number }>())?.n;

describe("signInMember", () => {
  it("signs an active member in and leaves a session", async () => {
    const userId = await makeMember("active@example.com", "active_one", "active");

    const result = await signInMember(auth(), getDb(env.DB), { email: "Active@Example.com", password: "a-long-enough-pass" });

    expect(result).toEqual({ ok: true, userId });
    expect(await sessionCount(userId)).toBe(1);
  });

  it("gives the same answer for a wrong password and for an unknown email", async () => {
    await makeMember("known@example.com", "known_one", "active");

    const wrongPassword = await signInMember(auth(), getDb(env.DB), { email: "known@example.com", password: "not-the-password" });
    const unknownEmail = await signInMember(auth(), getDb(env.DB), { email: "nobody@example.com", password: "whatever-pass-1" });

    expect(wrongPassword).toMatchObject({ ok: false, code: "invalid" });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("refuses a Pending account and leaves no session behind", async () => {
    const userId = await makeMember("waiting@example.com", "waiting_one", "pending");

    const result = await signInMember(auth(), getDb(env.DB), { email: "waiting@example.com", password: "a-long-enough-pass" });

    expect(result).toMatchObject({ ok: false, code: "pending" });
    expect(await sessionCount(userId)).toBe(0);
  });

  it("does not reveal that an account is Pending when the password is wrong", async () => {
    await makeMember("shy@example.com", "shy_one", "pending");

    const result = await signInMember(auth(), getDb(env.DB), { email: "shy@example.com", password: "guessing-wrong-1" });

    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses an account with no profile", async () => {
    const { user } = await auth().api.signUpEmail({
      body: { email: "noprofile@example.com", password: "a-long-enough-pass", name: "No Profile" },
    });
    await clearSessions(user.id);

    const result = await signInMember(auth(), getDb(env.DB), { email: "noprofile@example.com", password: "a-long-enough-pass" });

    expect(result).toMatchObject({ ok: false, code: "pending" });
    expect(await sessionCount(user.id)).toBe(0);
  });

  it.each([
    ["an empty form", {}],
    ["a malformed email", { email: "not-an-email", password: "a-long-enough-pass" }],
    ["an empty password", { email: "a@example.com", password: "" }],
    ["a huge password", { email: "a@example.com", password: "x".repeat(5000) }],
  ])("rejects %s without touching the database", async (_name, input) => {
    expect(await signInMember(auth(), getDb(env.DB), input)).toMatchObject({ ok: false, code: "invalid" });
  });
});
