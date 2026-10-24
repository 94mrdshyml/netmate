import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS, clientIp, limitPost, limitSignIn, limitSignUp, postSubject, pruneRateHits, takeSlot, tooManyMessage } from "@/server/rate-limit";

const SALT = "test-salt-for-rate-limits";
const MIN = 60_000;
const T0 = 1_800_000_000_000;
const tiny = (name: string, max = 3) => ({ name, max, windowMs: 10 * MIN });

const hits = async (like: string) =>
  (await env.DB.prepare("select count(*) as n from rate_hits where key like ?").bind(like).first<{ n: number }>())?.n;

describe("takeSlot", () => {
  it("allows up to the maximum, then refuses", async () => {
    const limit = tiny("t:max");
    for (let i = 0; i < 3; i++) expect(await takeSlot(env.DB, limit, "who", SALT, T0 + i)).toEqual({ ok: true });
    expect(await takeSlot(env.DB, limit, "who", SALT, T0 + 10)).toMatchObject({ ok: false });
  });

  it("does not record a refused attempt, so hammering never extends the wait", async () => {
    const limit = tiny("t:norecord", 1);
    await takeSlot(env.DB, limit, "who", SALT, T0);
    for (let i = 1; i <= 5; i++) await takeSlot(env.DB, limit, "who", SALT, T0 + i * 1000);
    expect(await hits("t:norecord:%")).toBe(1);
  });

  it("tells how long to wait, counted from the oldest attempt in the window", async () => {
    const limit = tiny("t:retry", 2);
    await takeSlot(env.DB, limit, "who", SALT, T0);
    await takeSlot(env.DB, limit, "who", SALT, T0 + 2 * MIN);

    const refused = await takeSlot(env.DB, limit, "who", SALT, T0 + 3 * MIN);

    expect(refused).toEqual({ ok: false, retryAfterSeconds: 7 * 60 });
  });

  it("lets the person back in once the oldest attempt leaves the window", async () => {
    const limit = tiny("t:slide", 1);
    await takeSlot(env.DB, limit, "who", SALT, T0);
    expect(await takeSlot(env.DB, limit, "who", SALT, T0 + 9 * MIN)).toMatchObject({ ok: false });
    expect(await takeSlot(env.DB, limit, "who", SALT, T0 + 10 * MIN + 1)).toEqual({ ok: true });
  });

  it("keeps different people and different limits apart", async () => {
    const a = tiny("t:apart-a", 1);
    const b = tiny("t:apart-b", 1);
    await takeSlot(env.DB, a, "alice", SALT, T0);
    expect(await takeSlot(env.DB, a, "bob", SALT, T0)).toEqual({ ok: true });
    expect(await takeSlot(env.DB, b, "alice", SALT, T0)).toEqual({ ok: true });
    expect(await takeSlot(env.DB, a, "alice", SALT, T0)).toMatchObject({ ok: false });
  });

  it("treats an email the same whatever its case", async () => {
    const limit = tiny("t:case", 1);
    await takeSlot(env.DB, limit, "Riya@Example.com", SALT, T0);
    expect(await takeSlot(env.DB, limit, "riya@example.COM", SALT, T0)).toMatchObject({ ok: false });
  });

  it("gives exactly the maximum when many requests arrive at the same moment", async () => {
    const limit = tiny("t:race", 5);
    const results = await Promise.all(Array.from({ length: 25 }, () => takeSlot(env.DB, limit, "crowd", SALT, T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await hits("t:race:%")).toBe(5);
  });

  it("stores a salted hash, never the address or email", async () => {
    await takeSlot(env.DB, tiny("t:privacy"), "203.0.113.7", SALT, T0);
    await takeSlot(env.DB, tiny("t:privacy"), "riya@example.com", SALT, T0);
    const keys = (await env.DB.prepare("select key from rate_hits where key like 't:privacy:%'").all<{ key: string }>()).results;
    expect(keys).toHaveLength(2);
    for (const { key } of keys) {
      expect(key).toMatch(/^t:privacy:[0-9a-f]{32}$/);
      expect(key).not.toContain("203.0.113.7");
      expect(key).not.toContain("riya");
    }
  });

  it("gives a different key with a different salt", async () => {
    const limit = tiny("t:salt", 1);
    await takeSlot(env.DB, limit, "who", "salt-one-salt-one-salt-one-aa", T0);
    expect(await takeSlot(env.DB, limit, "who", "salt-two-salt-two-salt-two-bb", T0)).toEqual({ ok: true });
  });
});

describe("the PRD limits", () => {
  it("allows 10 sign-in attempts per email in 10 minutes, then refuses the 11th", async () => {
    const who = { ip: "198.51.100.1", email: "limit-me@example.com" };
    for (let i = 0; i < LIMITS.signInEmail.max; i++) {
      expect(await limitSignIn(env.DB, SALT, { ...who, ip: `198.51.100.${i + 10}` }, T0 + i)).toEqual({ ok: true });
    }
    expect(await limitSignIn(env.DB, SALT, { ...who, ip: "198.51.100.99" }, T0 + 50)).toMatchObject({ ok: false });
  });

  it("allows 30 sign-in attempts per IP in 10 minutes, whatever the emails", async () => {
    for (let i = 0; i < LIMITS.signInIp.max; i++) {
      expect(await limitSignIn(env.DB, SALT, { ip: "198.51.100.2", email: `p${i}@example.com` }, T0 + i)).toEqual({ ok: true });
    }
    expect(await limitSignIn(env.DB, SALT, { ip: "198.51.100.2", email: "one-more@example.com" }, T0 + 50)).toMatchObject({ ok: false });
  });

  it("allows 10 sign-ups per IP in 10 minutes", async () => {
    for (let i = 0; i < LIMITS.signUpIp.max; i++) {
      expect(await limitSignUp(env.DB, SALT, { ip: "198.51.100.3", inviteLinkId: `inv_${i}` }, T0 + i)).toEqual({ ok: true });
    }
    expect(await limitSignUp(env.DB, SALT, { ip: "198.51.100.3", inviteLinkId: "inv_x" }, T0 + 50)).toMatchObject({ ok: false });
  });

  it("limits sign-ups per invite link across different IPs", async () => {
    for (let i = 0; i < LIMITS.signUpLink.max; i++) {
      expect(await limitSignUp(env.DB, SALT, { ip: `192.0.2.${i}`, inviteLinkId: "inv_busy" }, T0 + i)).toEqual({ ok: true });
    }
    expect(await limitSignUp(env.DB, SALT, { ip: "192.0.2.200", inviteLinkId: "inv_busy" }, T0 + 50)).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("reads the address Cloudflare reports, with a fallback", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": " 203.0.113.9 " }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("words the wait in whole minutes", () => {
    expect(tooManyMessage(1)).toBe("Too many attempts. Try again in 1 minute.");
    expect(tooManyMessage(61)).toBe("Too many attempts. Try again in 2 minutes.");
    expect(tooManyMessage(600)).toBe("Too many attempts. Try again in 10 minutes.");
  });

  it("prunes only old hits", async () => {
    const limit = tiny("t:prune", 5);
    await takeSlot(env.DB, limit, "old", SALT, T0 - 2 * 24 * 60 * MIN);
    await takeSlot(env.DB, limit, "new", SALT, T0);

    const removed = await pruneRateHits(env.DB, 24 * 60 * MIN, T0 + MIN);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await hits("t:prune:%")).toBe(1);
  });
});

describe("the post limit (10 a minute per person)", () => {
  it("allows ten posts in a minute, refuses the eleventh with the wait, and lets the person back in when the minute is over", async () => {
    const who = "usr_postlimit_user_aaaaaaaa";
    for (let i = 0; i < 10; i++) expect(await limitPost(env.DB, SALT, who, T0 + i * 1000)).toEqual({ ok: true });
    const refused = await limitPost(env.DB, SALT, who, T0 + 30_000);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok === false && refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.ok === false && refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Hammering does not extend the wait, and a minute after the first post there is room again.
    expect(await limitPost(env.DB, SALT, who, T0 + 59_000)).toMatchObject({ ok: false });
    expect(await limitPost(env.DB, SALT, who, T0 + MIN + 1)).toEqual({ ok: true });
  });

  it("counts each person apart", async () => {
    for (let i = 0; i < 10; i++) await limitPost(env.DB, SALT, "usr_postlimit_user_bbbbbbbb", T0 + i);
    expect(await limitPost(env.DB, SALT, "usr_postlimit_user_bbbbbbbb", T0 + 20)).toMatchObject({ ok: false });
    expect(await limitPost(env.DB, SALT, "usr_postlimit_user_cccccccc", T0 + 20)).toEqual({ ok: true });
  });
});

describe("a test's own posting allowance", () => {
  const who = "usr_scope_user_aaaaaaaaaaaa";

  it("splits one person's posts by scope, so two tests never share an allowance, but only when ENV is exactly test", async () => {
    expect(postSubject({ ENV: "test" }, who, "abc-123")).toBe(`${who}:abc-123`);
    for (let i = 0; i < 10; i++) await limitPost(env.DB, SALT, postSubject({ ENV: "test" }, who, "one"), T0 + i);
    expect(await limitPost(env.DB, SALT, postSubject({ ENV: "test" }, who, "one"), T0 + 20)).toMatchObject({ ok: false });
    expect(await limitPost(env.DB, SALT, postSubject({ ENV: "test" }, who, "two"), T0 + 20)).toEqual({ ok: true });
  });

  it("cannot be used on a real site: any other ENV, or no ENV, ignores the scope and counts the person", () => {
    for (const real of [{}, { ENV: undefined }, { ENV: "" }, { ENV: "production" }, { ENV: "Test" }, { ENV: "TEST" }, { ENV: " test" }, { ENV: "test " }, { ENV: "testing" }]) {
      expect(postSubject(real, who, "abc-123"), JSON.stringify(real)).toBe(who);
    }
  });

  it("ignores a missing or odd scope, even in test mode", () => {
    for (const scope of [undefined, null, "", "a b", "a/b", "a:b", "x".repeat(65), "<script>", "é"]) {
      expect(postSubject({ ENV: "test" }, who, scope), String(scope)).toBe(who);
    }
  });
});
