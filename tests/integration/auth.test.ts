import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function auth() {
  return createAuth({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
}

describe("Better Auth on D1 (spike 2)", () => {
  it("signs up with a UUID text id and stores a password hash, never the password", async () => {
    const t0 = performance.now();
    const res = await auth().api.signUpEmail({
      body: { email: "Riya@Example.com", password: "correct horse battery", name: "Riya Sen" },
    });
    const ms = Math.round(performance.now() - t0);
    console.info(`[spike 2] sign-up (includes password hashing): ${ms} ms`);

    expect(res.user.id).toMatch(UUID);
    expect(res.user.email).toBe("riya@example.com");

    const account = await env.DB.prepare("select id, password from account where user_id = ?")
      .bind(res.user.id)
      .first<{ id: string; password: string }>();
    expect(account?.id).toMatch(UUID);
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain("correct horse battery");
  });

  it("rejects a duplicate email regardless of case", async () => {
    await auth().api.signUpEmail({
      body: { email: "dup@example.com", password: "password-one-1", name: "One" },
    });
    await expect(
      auth().api.signUpEmail({
        body: { email: "DUP@example.com", password: "password-two-2", name: "Two" },
      }),
    ).rejects.toThrow();
  });

  it("signs in, returns a session cookie and resolves the session from it", async () => {
    await auth().api.signUpEmail({
      body: { email: "mina@example.com", password: "a-long-enough-pass", name: "Mina" },
    });

    const t0 = performance.now();
    const { headers, response } = await auth().api.signInEmail({
      body: { email: "mina@example.com", password: "a-long-enough-pass" },
      returnHeaders: true,
    });
    console.info(`[spike 2] sign-in (includes password verify): ${Math.round(performance.now() - t0)} ms`);

    expect(response.user.id).toMatch(UUID);
    const cookie = headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const session = await auth().api.getSession({
      headers: new Headers({ cookie: (cookie ?? "").split(";")[0] ?? "" }),
    });
    expect(session?.user.email).toBe("mina@example.com");
    expect(session?.session.userId).toBe(response.user.id);
  });

  it("rejects a wrong password", async () => {
    await auth().api.signUpEmail({
      body: { email: "wrong@example.com", password: "right-password-1", name: "Wrong" },
    });
    await expect(
      auth().api.signInEmail({ body: { email: "wrong@example.com", password: "not-the-password" } }),
    ).rejects.toThrow();
  });

  it("enforces the PRD password length (8 to 128)", async () => {
    await expect(
      auth().api.signUpEmail({ body: { email: "short@example.com", password: "short", name: "S" } }),
    ).rejects.toThrow();
    await expect(
      auth().api.signUpEmail({ body: { email: "long@example.com", password: "x".repeat(129), name: "L" } }),
    ).rejects.toThrow();
  });

  it("deleting a user cascades to accounts and sessions", async () => {
    const { user } = await auth().api.signUpEmail({
      body: { email: "gone@example.com", password: "delete-me-please", name: "Gone" },
    });
    await auth().api.signInEmail({ body: { email: "gone@example.com", password: "delete-me-please" } });

    await env.DB.prepare("delete from user where id = ?").bind(user.id).run();

    const rows = await env.DB.prepare(
      "select (select count(*) from account where user_id = ?1) as a, (select count(*) from session where user_id = ?1) as s",
    )
      .bind(user.id)
      .first<{ a: number; s: number }>();
    expect(rows).toEqual({ a: 0, s: 0 });
  });
});
