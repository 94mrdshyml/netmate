import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb, schema } from "@/db";
import { clearInstanceCache, readInstance } from "@/instance/settings";
import { completeSetup, setupProblems, type SetupEnv } from "@/instance/setup";
import { isId } from "@/lib/ids";
import { decryptSecret } from "@/lib/secrets";

const db = getDb(env.DB);
const setupEnv = env as unknown as Required<SetupEnv>;

const input = {
  token: setupEnv.SETUP_TOKEN,
  firstName: "Riya",
  lastName: "Sen",
  email: "riya@example.com",
  username: "riya_sen",
  password: "correct horse battery",
  name: "Green Valley School",
  primary: "#0B6E4F",
  radius: "lg",
  fontFamily: "Space Grotesk",
  avatarStyle: "thumbs",
  placesEnabled: false,
};

const resendOk = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
const resendStatus = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

async function counts() {
  const row = await env.DB.prepare(
    "select (select count(*) from user) as users, (select count(*) from account) as accounts, (select count(*) from profiles) as profiles, (select count(*) from instance) as instances, (select count(*) from instance_secrets) as secrets",
  ).first<Record<string, number>>();
  return row as { users: number; accounts: number; profiles: number; instances: number; secrets: number };
}

beforeEach(async () => {
  clearInstanceCache();
  await env.DB.batch([
    env.DB.prepare("delete from invite_uses"),
    env.DB.prepare("delete from invite_links"),
    env.DB.prepare("delete from profiles"),
    env.DB.prepare("delete from instance_secrets"),
    env.DB.prepare("delete from instance"),
    env.DB.prepare("delete from session"),
    env.DB.prepare("delete from account"),
    env.DB.prepare("delete from user"),
  ]);
});

describe("completeSetup: success", () => {
  it("creates the admin, profile, settings and nothing else, all at once", async () => {
    const result = await completeSetup(setupEnv, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isId("user", result.userId)).toBe(true);
    expect(await counts()).toEqual({ users: 1, accounts: 1, profiles: 1, instances: 1, secrets: 0 });

    const profile = await db.select().from(schema.profiles).get();
    expect(profile).toMatchObject({
      userId: result.userId,
      username: "riya_sen",
      firstName: "Riya",
      lastName: "Sen",
      role: "admin",
      status: "active",
      invitedBy: null,
    });

    const state = await readInstance(db);
    expect(state.configured).toBe(true);
    expect(state.settings).toMatchObject({
      name: "Green Valley School",
      primaryColor: "#0B6E4F",
      radius: "lg",
      fontFamily: "Space Grotesk",
      avatarStyle: "thumbs",
      inviteQuota: 5,
      gifsEnabled: false,
      placesEnabled: false,
    });
  });

  it("stores a hashed password the admin can sign in with, and never the password itself", async () => {
    await completeSetup(setupEnv, input);
    const account = await db.select().from(schema.account).get();
    expect(account?.providerId).toBe("credential");
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain("correct horse battery");
    expect(isId("account", account?.id)).toBe(true);

    const auth = createAuth({ DB: env.DB, AUTH_SECRET: setupEnv.AUTH_SECRET });
    const signedIn = await auth.api.signInEmail({ body: { email: "riya@example.com", password: "correct horse battery" } });
    expect(signedIn.user.email).toBe("riya@example.com");
    await expect(
      auth.api.signInEmail({ body: { email: "riya@example.com", password: "wrong password here" } }),
    ).rejects.toThrow();
  });

  it("lower-cases the email and username", async () => {
    await completeSetup(setupEnv, { ...input, email: "Riya@Example.COM", username: "Riya_Sen" });
    const u = await env.DB.prepare("select email from user").first<{ email: string }>();
    const p = await db.select().from(schema.profiles).get();
    expect(u?.email).toBe("riya@example.com");
    expect(p?.username).toBe("riya_sen");
  });

  it("encrypts the optional keys and turns GIF search on only when a Klipy key is given", async () => {
    const result = await completeSetup(
      setupEnv,
      { ...input, resendApiKey: "re_live_secret", resendFrom: "hello@school.org", klipyApiKey: "klipy-key-123", placesEnabled: true },
      { fetch: resendOk },
    );
    expect(result.ok).toBe(true);

    const rows = await db.select().from(schema.instanceSecrets).all();
    expect(rows.map((r) => r.name).sort()).toEqual(["klipy_api_key", "resend_api_key", "resend_from"]);
    for (const row of rows) expect(row.value).toMatch(/^v1:/);
    const resend = rows.find((r) => r.name === "resend_api_key");
    expect(resend?.value).not.toContain("re_live_secret");
    expect(await decryptSecret(resend?.value ?? "", "resend_api_key", setupEnv.SETTINGS_ENCRYPTION_KEY)).toBe("re_live_secret");

    const { settings } = await readInstance(db);
    expect(settings.gifsEnabled).toBe(true);
    expect(settings.placesEnabled).toBe(true);
  });
});

describe("completeSetup: who may do it", () => {
  it("refuses a wrong token and writes nothing", async () => {
    const result = await completeSetup(setupEnv, { ...input, token: "not-the-token" });
    expect(result).toMatchObject({ ok: false, code: "bad_token" });
    expect(await counts()).toEqual({ users: 0, accounts: 0, profiles: 0, instances: 0, secrets: 0 });
  });

  it("refuses a token that is one character off, empty, or missing", async () => {
    const off = setupEnv.SETUP_TOKEN.slice(0, -1) + "X";
    for (const token of [off, "", undefined, null, 12345]) {
      const result = await completeSetup(setupEnv, { ...input, token });
      expect(result).toMatchObject({ ok: false, code: "bad_token" });
    }
    expect((await counts()).users).toBe(0);
  });

  it("checks the token before the form, so a stranger learns nothing about the rules", async () => {
    const result = await completeSetup(setupEnv, { token: "wrong", username: "admin" });
    expect(result).toMatchObject({ ok: false, code: "bad_token" });
    expect(result.ok === false && result.fieldErrors).toEqual({ token: "That setup token is not correct" });
  });

  it("refuses to run at all when the deployment has no usable secrets, and says which", async () => {
    for (const [override, expected] of [
      [{ SETUP_TOKEN: undefined }, "SETUP_TOKEN"],
      [{ SETUP_TOKEN: "too-short" }, "SETUP_TOKEN"],
      [{ AUTH_SECRET: "short" }, "AUTH_SECRET"],
      [{ SETTINGS_ENCRYPTION_KEY: undefined }, "SETTINGS_ENCRYPTION_KEY"],
    ] as const) {
      const result = await completeSetup({ ...setupEnv, ...override }, { ...input, token: "too-short" });
      expect(result).toMatchObject({ ok: false, code: "not_configured" });
      expect(result.ok === false && result.message).toContain(expected);
    }
    expect(setupProblems(setupEnv)).toEqual([]);
    expect((await counts()).users).toBe(0);
  });

  it("never puts a secret value in an error message", async () => {
    const result = await completeSetup({ ...setupEnv, AUTH_SECRET: "short-secret-value" }, input);
    expect(JSON.stringify(result)).not.toContain("short-secret-value");
    expect(JSON.stringify(await completeSetup(setupEnv, { ...input, token: "x" }))).not.toContain(setupEnv.SETUP_TOKEN);
  });
});

describe("completeSetup: validation", () => {
  it("returns field errors for a bad form and writes nothing", async () => {
    const result = await completeSetup(setupEnv, {
      ...input,
      username: "admin",
      password: "short",
      primary: "red",
      radius: "huge",
      fontFamily: "Comic Sans",
    });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["fontFamily", "password", "primary", "radius", "username"]);
    expect(await counts()).toEqual({ users: 0, accounts: 0, profiles: 0, instances: 0, secrets: 0 });
  });
});

describe("completeSetup: only once", () => {
  it("refuses a second setup and leaves the first untouched", async () => {
    expect((await completeSetup(setupEnv, input)).ok).toBe(true);
    const again = await completeSetup(setupEnv, { ...input, email: "other@example.com", username: "other_one", name: "Hijacked" });
    expect(again).toMatchObject({ ok: false, code: "already_configured" });
    expect(await counts()).toEqual({ users: 1, accounts: 1, profiles: 1, instances: 1, secrets: 0 });
    expect((await readInstance(db)).settings.name).toBe("Green Valley School");
  });

  it("lets exactly one of two simultaneous attempts win, with no leftovers from the loser", async () => {
    const [a, b] = await Promise.all([
      completeSetup(setupEnv, { ...input, email: "a@example.com", username: "first_admin", name: "First" }),
      completeSetup(setupEnv, { ...input, email: "b@example.com", username: "second_admin", name: "Second" }),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ code: "already_configured" });
    expect(await counts()).toEqual({ users: 1, accounts: 1, profiles: 1, instances: 1, secrets: 0 });
  });

  it("rolls everything back if any part of the write fails", async () => {
    // A pre-existing member with the same username makes the profile insert fail,
    // after the user and account rows have already been queued in the batch.
    await env.DB.batch([
      env.DB.prepare("insert into user (id, name, email) values ('usr_existing000000000000000', 'Old', 'old@example.com')"),
      env.DB.prepare("insert into profiles (user_id, username, first_name, last_name) values ('usr_existing000000000000000', 'riya_sen', 'Old', 'Member')"),
    ]);
    const result = await completeSetup(setupEnv, input);
    expect(result).toMatchObject({ ok: false, code: "failed" });
    // Only the pre-existing rows remain: no second user, no account, no instance.
    expect(await counts()).toEqual({ users: 1, accounts: 0, profiles: 1, instances: 0, secrets: 0 });
    expect((await readInstance(db)).configured).toBe(false);
  });

  it("reports a taken email without leaving a half-made admin", async () => {
    await env.DB.prepare("insert into user (id, name, email) values ('usr_existing000000000000000', 'Old', 'riya@example.com')").run();
    const result = await completeSetup(setupEnv, input);
    expect(result).toMatchObject({ ok: false, code: "email_taken" });
    expect(await counts()).toEqual({ users: 1, accounts: 0, profiles: 0, instances: 0, secrets: 0 });
  });

  it("does not echo database errors back to the browser", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into user (id, name, email) values ('usr_existing000000000000000', 'Old', 'old@example.com')"),
      env.DB.prepare("insert into profiles (user_id, username, first_name, last_name) values ('usr_existing000000000000000', 'riya_sen', 'Old', 'Member')"),
    ]);
    const result = await completeSetup(setupEnv, input);
    expect(JSON.stringify(result)).not.toMatch(/UNIQUE|constraint|profiles\.|SQLITE/i);
  });
});

describe("completeSetup: Resend key", () => {
  const withKey = { ...input, resendApiKey: "re_live_secret", resendFrom: "hello@school.org" };

  it("refuses a key Resend rejects, and writes nothing", async () => {
    const result = await completeSetup(setupEnv, withKey, { fetch: resendStatus(401, { name: "invalid_api_key" }) });
    expect(result).toMatchObject({ ok: false, code: "resend_invalid" });
    expect(await counts()).toEqual({ users: 0, accounts: 0, profiles: 0, instances: 0, secrets: 0 });
  });

  it("accepts a sending-only key", async () => {
    const result = await completeSetup(setupEnv, withKey, { fetch: resendStatus(401, { name: "restricted_api_key" }) });
    expect(result.ok).toBe(true);
  });

  it("asks to retry or skip when Resend cannot be reached", async () => {
    const result = await completeSetup(setupEnv, withKey, { fetch: resendStatus(503) });
    expect(result).toMatchObject({ ok: false, code: "resend_unreachable" });
    expect((await counts()).users).toBe(0);
  });

  it("does not call Resend at all when no key is given", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await completeSetup(setupEnv, input, { fetch: spy });
    expect(called).toBe(false);
  });
});

describe("one admin", () => {
  it("the database refuses a second admin even if the app is bypassed", async () => {
    await completeSetup(setupEnv, input);
    await env.DB.prepare("insert into user (id, name, email) values ('usr_second0000000000000000', 'Two', 'two@example.com')").run();
    await expect(
      env.DB.prepare("insert into profiles (user_id, username, first_name, last_name, role) values ('usr_second0000000000000000', 'admin_two', 'Two', 'Admin', 'admin')").run(),
    ).rejects.toThrow();
    const admins = await db.select().from(schema.profiles).where(eq(schema.profiles.role, "admin")).all();
    expect(admins).toHaveLength(1);
  });
});
