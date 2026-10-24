import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { LIMITS, limitPolarTest } from "@/server/rate-limit";
import { paymentPanel, readAccess, readPaymentSettings, removePaymentKeys, savePaymentConnection, savePaymentSplit, testPolar } from "@/server/payments";

const db = () => getDb(env.DB);
const KEY = "k".repeat(40);
// Made-up keys, built from repeated words so that no key-shaped text sits in the file (the secret scan would flag it).
const TOKEN = `polar_oat_${"faketoken".repeat(3)}`;
const SECRET = `whsec_${"fakesecret".repeat(3)}`;
const rows = async () => (await env.DB.prepare("select name, value from instance_secrets where name like 'polar_%' order by name").all<{ name: string; value: string }>()).results;

afterEach(async () => {
  vi.unstubAllGlobals();
  await removePaymentKeys(db());
  await env.DB.prepare("delete from payment_settings").run();
});

describe("the Polar connection", () => {
  it("starts with nothing saved and test mode", async () => {
    expect(await readPaymentSettings(db())).toEqual({ mode: "sandbox", creatorPercent: 50 });
    expect(await paymentPanel(db(), KEY)).toEqual({ mode: "sandbox", creatorPercent: 50, hasToken: false, hasWebhookSecret: false, readable: true });
    expect(await readAccess(db(), KEY)).toBeNull();
  });

  it("saves the keys locked, reads them back for the server, and never shows them", async () => {
    expect(await savePaymentConnection(db(), KEY, { mode: "production", accessToken: TOKEN, webhookSecret: SECRET })).toEqual({ ok: true });

    const stored = await rows();
    expect(stored.map((r) => r.name)).toEqual(["polar_access_token", "polar_webhook_secret"]);
    for (const r of stored) {
      expect(r.value).toMatch(/^v1:/);
      expect(r.value).not.toContain(TOKEN);
      expect(r.value).not.toContain(SECRET);
    }
    const panel = await paymentPanel(db(), KEY);
    expect(panel).toEqual({ mode: "production", creatorPercent: 50, hasToken: true, hasWebhookSecret: true, readable: true });
    expect(JSON.stringify(panel)).not.toContain(TOKEN);
    expect(await readAccess(db(), KEY)).toEqual({ mode: "production", token: TOKEN, webhookSecret: SECRET });
  });

  it("keeps a saved key when its box is left blank, and replaces it when a new one is pasted", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    expect(await savePaymentConnection(db(), KEY, { mode: "production", accessToken: "", webhookSecret: "  " })).toEqual({ ok: true });
    expect(await readAccess(db(), KEY)).toEqual({ mode: "production", token: TOKEN, webhookSecret: SECRET });

    const newer = `polar_oat_${"newertoken".repeat(3)}`;
    await savePaymentConnection(db(), KEY, { mode: "production", accessToken: newer });
    expect(await readAccess(db(), KEY)).toEqual({ mode: "production", token: newer, webhookSecret: SECRET });
  });

  it("refuses bad input and saves nothing", async () => {
    expect(await savePaymentConnection(db(), KEY, { mode: "staging", accessToken: TOKEN, webhookSecret: SECRET })).toMatchObject({ ok: false });
    expect(await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: "too short", webhookSecret: SECRET })).toMatchObject({ ok: false });
    expect(await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: `${TOKEN} extra`, webhookSecret: SECRET })).toMatchObject({ ok: false });
    expect(await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: "<script>alert(1)</script>" })).toMatchObject({ ok: false });
    expect(await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: "x".repeat(301) })).toMatchObject({ ok: false });
    expect(await rows()).toHaveLength(0);
    expect(await env.DB.prepare("select count(*) as n from payment_settings").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("will not store a key on a server that has no encryption key", async () => {
    expect(await savePaymentConnection(db(), undefined, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET })).toMatchObject({ ok: false, message: expect.stringContaining("SETTINGS_ENCRYPTION_KEY") });
    expect(await savePaymentConnection(db(), "short", { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET })).toMatchObject({ ok: false });
    expect(await rows()).toHaveLength(0);
    // Saving only the mode needs no key.
    expect(await savePaymentConnection(db(), undefined, { mode: "production" })).toEqual({ ok: true });
  });

  it("says when saved keys can no longer be read", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    expect(await paymentPanel(db(), "j".repeat(40))).toMatchObject({ hasToken: true, hasWebhookSecret: true, readable: false });
    expect(await readAccess(db(), "j".repeat(40))).toBeNull();
    expect(await readAccess(db(), undefined)).toBeNull();
  });

  it("a value copied under the other name cannot be read (each is locked to its name)", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    const [token] = await rows();
    await env.DB.prepare("update instance_secrets set value = ? where name = 'polar_webhook_secret'").bind(token!.value).run();
    expect(await readAccess(db(), KEY)).toBeNull();
  });

  it("removes both keys", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    expect(await removePaymentKeys(db())).toBe(true);
    expect(await rows()).toHaveLength(0);
    expect(await paymentPanel(db(), KEY)).toMatchObject({ hasToken: false, hasWebhookSecret: false });
  });

  it("leaves the other keys (Resend, Klipy) alone", async () => {
    await env.DB.prepare("insert into instance_secrets (name, value) values ('klipy_api_key', 'v1:a:b') on conflict(name) do nothing").run();
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    await removePaymentKeys(db());
    expect(await env.DB.prepare("select count(*) as n from instance_secrets where name = 'klipy_api_key'").first<{ n: number }>()).toEqual({ n: 1 });
    await env.DB.prepare("delete from instance_secrets where name = 'klipy_api_key'").run();
  });
});

describe("the split", () => {
  it("saves a whole percent from 0 to 100 and keeps the mode", async () => {
    await savePaymentConnection(db(), KEY, { mode: "production" });
    for (const [input, percent] of [["55", 55], [" 0 ", 0], ["100", 100], [45, 45]] as const) {
      expect(await savePaymentSplit(db(), input)).toEqual({ ok: true });
      expect(await readPaymentSettings(db())).toEqual({ mode: "production", creatorPercent: percent });
    }
  });

  it("refuses anything else and keeps what was saved", async () => {
    await savePaymentSplit(db(), "40");
    for (const bad of ["101", "-1", "55.5", "abc", "", "1e2", 55.5, null, undefined, "1000"]) {
      expect(await savePaymentSplit(db(), bad), String(bad)).toMatchObject({ ok: false });
    }
    expect((await readPaymentSettings(db())).creatorPercent).toBe(40);
  });

  it("is checked by the database too", async () => {
    const put = (mode: string, pct: number, id = "singleton") => env.DB.prepare("insert into payment_settings (id, mode, creator_percent) values (?, ?, ?)").bind(id, mode, pct).run();
    await expect(put("sandbox", 101)).rejects.toThrow();
    await expect(put("sandbox", -1)).rejects.toThrow();
    await expect(put("staging", 50)).rejects.toThrow();
    await expect(put("sandbox", 50, "second")).rejects.toThrow();
    await put("production", 100);
    await expect(put("sandbox", 50)).rejects.toThrow(); // one row only
  });

  it("the secrets table accepts the Polar names and still refuses others", async () => {
    const put = (name: string) => env.DB.prepare("insert into instance_secrets (name, value) values (?, 'v1:a:b')").bind(name).run();
    await put("polar_access_token");
    await put("polar_webhook_secret");
    await expect(put("polar_other")).rejects.toThrow();
    await expect(put("anything")).rejects.toThrow();
  });
});

describe("testing the connection", () => {
  it("needs both keys first", async () => {
    expect(await testPolar(db(), KEY)).toEqual({ ok: false, message: "Save the access token and the webhook secret first." });
  });

  it("calls Polar in the saved mode with the token, and says it worked", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    expect(await testPolar(db(), KEY)).toEqual({ ok: true, message: "Connected to Polar in test mode." });
    expect(seen).toEqual([{ url: "https://sandbox-api.polar.sh/v1/products/?limit=1", auth: `Bearer ${TOKEN}` }]);

    await savePaymentConnection(db(), KEY, { mode: "production" });
    seen.length = 0;
    expect(await testPolar(db(), KEY)).toEqual({ ok: true, message: "Connected to Polar in live mode." });
    expect(seen[0]?.url).toBe("https://api.polar.sh/v1/products/?limit=1");
  });

  it("explains a refusal and never repeats the token", async () => {
    await savePaymentConnection(db(), KEY, { mode: "production", accessToken: TOKEN, webhookSecret: SECRET });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: `bad ${TOKEN}` }), { status: 401 }));
    const wrong = await testPolar(db(), KEY);
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain("did not accept that access token");
    expect(wrong.message).toContain("live mode");
    expect(wrong.message).not.toContain(TOKEN);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: `scope for ${TOKEN}` }), { status: 403 }));
    const noScope = await testPolar(db(), KEY);
    expect(noScope.message).toContain("missing a permission");
    expect(noScope.message).not.toContain(TOKEN);
  });

  it("copes with Polar being unreachable", async () => {
    await savePaymentConnection(db(), KEY, { mode: "sandbox", accessToken: TOKEN, webhookSecret: SECRET });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    expect(await testPolar(db(), KEY)).toEqual({ ok: false, message: "Could not reach Polar. Try again in a moment." });
  });

  it("is limited to ten an hour per admin", async () => {
    const results = [];
    for (let i = 0; i < LIMITS.polarTest.max + 1; i++) results.push(await limitPolarTest(env.DB, "salt", "usr_polar_limit_aaaaaaaaaaa"));
    expect(results.filter((r) => r.ok)).toHaveLength(LIMITS.polarTest.max);
    expect(results[results.length - 1]?.ok).toBe(false);
  });
});
