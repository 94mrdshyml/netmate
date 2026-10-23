import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { emailState, instanceSecrets } from "@/db/schema";
import { fakeTransport, outbox, transportFor, type Transport } from "@/email/transport";
import type { EmailBrand } from "@/email/template";
import { LIMITS, limitTestEmail } from "@/server/rate-limit";
import { emailPanel, isEmailSetUp, readEmailConfig, removeEmailSettings, saveEmailSettings, sendEmail, sendTestEmail } from "@/server/email";

const db = () => getDb(env.DB);
const ENC = env.SETTINGS_ENCRYPTION_KEY!;
const KEY = "re_test_abcdefghijklmnop";
// Pieces joined at run time: these are fake values, and written out whole they look like leaked
// keys to the secret scanner.
const NOT_A_RESEND_KEY = ["sk", "123456789"].join("_");
const UNKNOWN_KEY = ["re", "live", "notaccepted12"].join("_");
const SECOND_KEY = ["re", "test", "secondsecond1"].join("_");
const brand: EmailBrand = { name: "Green Valley", primary: "#0B6E4F", radius: "md", fontFamily: "Inter", logoUrl: null };

beforeEach(async () => {
  outbox.length = 0;
  await db().delete(instanceSecrets);
  await db().delete(emailState);
});

async function setUp(from = "hello@example.org") {
  const res = await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: KEY, from });
  expect(res).toEqual({ ok: true });
}

describe("saveEmailSettings", () => {
  it("stores the key and the sender encrypted, never as plain text", async () => {
    await setUp("hello@example.org");

    const rows = await db().select().from(instanceSecrets);
    expect(rows.map((r) => r.name).sort()).toEqual(["resend_api_key", "resend_from"]);
    for (const row of rows) {
      expect(row.value).toMatch(/^v1:/);
      expect(row.value).not.toContain(KEY);
      expect(row.value).not.toContain("hello@example.org");
    }
    expect(await readEmailConfig(db(), ENC)).toEqual({ ok: true, config: { apiKey: KEY, from: "hello@example.org" } });
    expect(await isEmailSetUp(db())).toBe(true);
  });

  it("keeps the saved key when the key box is left empty, and changes only the sender", async () => {
    await setUp("hello@example.org");
    expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "", from: "news@example.org" })).toEqual({ ok: true });
    expect(await readEmailConfig(db(), ENC)).toEqual({ ok: true, config: { apiKey: KEY, from: "news@example.org" } });
  });

  it("replaces the key when a new one is given", async () => {
    await setUp();
    expect(await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: SECOND_KEY, from: "hello@example.org" })).toEqual({ ok: true });
    const config = await readEmailConfig(db(), ENC);
    expect(config.ok && config.config.apiKey).toBe(SECOND_KEY);
  });

  it.each([
    ["no key the first time", { from: "hello@example.org" }, "apiKey"],
    ["a key that does not start with re_", { apiKey: NOT_A_RESEND_KEY, from: "hello@example.org" }, "apiKey"],
    ["no sender", { apiKey: KEY, from: "" }, "from"],
    ["a sender that is not an address", { apiKey: KEY, from: "not-an-address" }, "from"],
    ["a sender over 254 characters", { apiKey: KEY, from: `${"a".repeat(250)}@example.org` }, "from"],
    ["a key over 200 characters", { apiKey: `re_${"x".repeat(250)}`, from: "hello@example.org" }, "apiKey"],
  ])("refuses %s and saves nothing", async (_label, input, field) => {
    const res = await saveEmailSettings(db(), fakeTransport, ENC, input);
    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { [field]: expect.any(String) } });
    expect(await db().select().from(instanceSecrets)).toHaveLength(0);
  });

  it("refuses non-object input", async () => {
    for (const raw of [null, undefined, "text", 5]) {
      expect(await saveEmailSettings(db(), fakeTransport, ENC, raw)).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("checks a new key with Resend and refuses one Resend does not accept", async () => {
    const res = await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: UNKNOWN_KEY, from: "hello@example.org" });
    expect(res).toMatchObject({ ok: false, code: "resend_invalid", fieldErrors: { apiKey: expect.stringContaining("did not accept") } });
    expect(await db().select().from(instanceSecrets)).toHaveLength(0);
  });

  it("says so when Resend cannot be reached, and saves nothing", async () => {
    const unreachable: Transport = { send: fakeTransport.send, checkKey: async () => ({ ok: false, reason: "unreachable" }) };
    const res = await saveEmailSettings(db(), unreachable, ENC, { apiKey: KEY, from: "hello@example.org" });
    expect(res).toMatchObject({ ok: false, code: "resend_unreachable" });
    expect(await isEmailSetUp(db())).toBe(false);
  });

  it("does not ask Resend again when only the sender changes", async () => {
    await setUp();
    let calls = 0;
    const counting: Transport = { send: fakeTransport.send, checkKey: async () => (calls++, { ok: true }) };
    await saveEmailSettings(db(), counting, ENC, { apiKey: "", from: "other@example.org" });
    expect(calls).toBe(0);
  });

  it("fails plainly when the encryption key is missing", async () => {
    expect(await saveEmailSettings(db(), fakeTransport, undefined, { apiKey: KEY, from: "hello@example.org" })).toMatchObject({ ok: false, code: "failed" });
    expect(await isEmailSetUp(db())).toBe(false);
  });
});

describe("readEmailConfig and the panel", () => {
  it("says missing before setup", async () => {
    expect(await readEmailConfig(db(), ENC)).toEqual({ ok: false, reason: "missing" });
    expect(await emailPanel(db(), ENC)).toMatchObject({ state: "not_set_up", from: null, lastSentAt: null, lastError: null });
  });

  it("says unreadable (not a crash) when the encryption key has changed", async () => {
    await setUp();
    const other = "a-different-encryption-key-0123456789-xyz";
    expect(await readEmailConfig(db(), other)).toEqual({ ok: false, reason: "unreadable" });
    expect(await emailPanel(db(), other)).toMatchObject({ state: "unreadable", from: null });
    expect(await readEmailConfig(db(), undefined)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("shows the sender but never the key", async () => {
    await setUp("hello@example.org");
    const panel = await emailPanel(db(), ENC);
    expect(panel).toMatchObject({ state: "set_up", from: "hello@example.org" });
    expect(JSON.stringify(panel)).not.toContain(KEY);
  });

  it("does not accept a value copied from the sender row into the key row", async () => {
    await setUp();
    const rows = await db().select().from(instanceSecrets);
    const from = rows.find((r) => r.name === "resend_from")!;
    await db().update(instanceSecrets).set({ value: from.value }).where(eq(instanceSecrets.name, "resend_api_key"));
    expect(await readEmailConfig(db(), ENC)).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("removeEmailSettings", () => {
  it("forgets both secrets and the last results", async () => {
    await setUp();
    await sendTestEmail(db(), fakeTransport, ENC, brand, "admin@example.org");
    expect(await removeEmailSettings(db())).toBe(true);
    expect(await isEmailSetUp(db())).toBe(false);
    expect(await emailPanel(db(), ENC)).toMatchObject({ state: "not_set_up", lastSentAt: null, lastError: null });
  });

  it("is fine to run when nothing is saved", async () => {
    expect(await removeEmailSettings(db())).toBe(true);
  });
});

describe("sendEmail and sendTestEmail", () => {
  it("sends from the saved sender and records the time", async () => {
    await setUp("hello@example.org");
    const res = await sendEmail(db(), fakeTransport, ENC, { to: "ada@example.org", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(res).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ from: "hello@example.org", to: "ada@example.org" });
    expect((await emailPanel(db(), ENC)).lastSentAt).toBeInstanceOf(Date);
  });

  it("refuses with a plain message when email is not set up, and sends nothing", async () => {
    const res = await sendEmail(db(), fakeTransport, ENC, { to: "ada@example.org", subject: "Hi", html: "x", text: "x" });
    expect(res).toEqual({ ok: false, message: "Email is not set up." });
    expect(outbox).toHaveLength(0);
  });

  it("records Resend's error, scrubbed of addresses, and shows it in the panel", async () => {
    await setUp("hello@nowhere.invalid");
    const res = await sendTestEmail(db(), fakeTransport, ENC, brand, "admin@example.org");
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining("not verified") });

    const panel = await emailPanel(db(), ENC);
    expect(panel.lastError).toContain("not verified");
    expect(panel.lastErrorAt).toBeInstanceOf(Date);
    expect(panel.lastSentAt).toBeNull();
  });

  it("stores no address or key even if Resend's text contains them", async () => {
    await setUp();
    const leaky: Transport = {
      checkKey: fakeTransport.checkKey,
      send: async () => ({ ok: false, message: `Rejected admin@example.org using ${KEY}` }),
    };
    await sendEmail(db(), leaky, ENC, { to: "admin@example.org", subject: "x", html: "x", text: "x" });
    const stored = (await db().select().from(emailState))[0]!;
    expect(stored.lastError).not.toContain("admin@example.org");
    expect(stored.lastError).not.toContain(KEY);
  });

  it("clears the last error after a good send", async () => {
    await setUp("hello@nowhere.invalid");
    await sendTestEmail(db(), fakeTransport, ENC, brand, "admin@example.org");
    await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: "", from: "hello@example.org" });
    await sendTestEmail(db(), fakeTransport, ENC, brand, "admin@example.org");
    expect(await emailPanel(db(), ENC)).toMatchObject({ lastError: null, lastErrorAt: null });
  });

  it("sends a test message branded with the instance name", async () => {
    await setUp();
    await sendTestEmail(db(), fakeTransport, ENC, brand, "admin@example.org");
    expect(outbox[0]!.subject).toBe("Test email from Green Valley");
    expect(outbox[0]!.html).toContain("Green Valley");
    expect(outbox[0]!.text).toContain("Email is working");
  });

  it("is told, not given, the fake: this Worker runs with ENV=test, and only then", () => {
    expect(env.ENV).toBe("test");
    expect(transportFor(env)).toBe(fakeTransport);
    expect(transportFor({})).not.toBe(fakeTransport);
  });
});

describe("email_state table rules", () => {
  it("accepts one row and refuses a second id or an error over 300 characters", async () => {
    await db().insert(emailState).values({ id: "singleton" });
    await expect(db().insert(emailState).values({ id: "other" })).rejects.toThrow();
    await expect(db().update(emailState).set({ lastError: "x".repeat(301) })).rejects.toThrow();
    await db().update(emailState).set({ lastError: "x".repeat(300) });
  });
});

describe("limitTestEmail", () => {
  it("allows five test emails an hour per person and then waits", async () => {
    const now = Date.now();
    for (let i = 0; i < LIMITS.testEmail.max; i++) {
      expect((await limitTestEmail(env.DB, env.AUTH_SECRET, "usr_limit_test_email_0001", now + i)).ok).toBe(true);
    }
    const sixth = await limitTestEmail(env.DB, env.AUTH_SECRET, "usr_limit_test_email_0001", now + 10);
    expect(sixth.ok).toBe(false);
    expect(await limitTestEmail(env.DB, env.AUTH_SECRET, "usr_limit_test_email_0002", now + 10)).toEqual({ ok: true });
  });
});

describe("saveEmailSettings reports every problem at once", () => {
  it("names a bad key and a bad sender together", async () => {
    const res = await saveEmailSettings(db(), fakeTransport, ENC, { apiKey: NOT_A_RESEND_KEY, from: "nope" });
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (!res.ok) expect(Object.keys(res.fieldErrors).sort()).toEqual(["apiKey", "from"]);
    if (!res.ok) expect(res.fieldErrors.apiKey).toContain("starts with re_");
  });

  it("still asks for a key when the sender is the only thing wrong and none is saved", async () => {
    const res = await saveEmailSettings(db(), fakeTransport, ENC, { from: "nope" });
    if (!res.ok) expect(Object.keys(res.fieldErrors).sort()).toEqual(["apiKey", "from"]);
  });
});
