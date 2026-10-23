import { describe, expect, it } from "vitest";
import { checkResendKey } from "@/email/resend";
import { safeEqual } from "@/lib/safe-compare";

describe("safeEqual", () => {
  it("is true only for identical strings", async () => {
    expect(await safeEqual("token-abc", "token-abc")).toBe(true);
    expect(await safeEqual("token-abc", "token-abd")).toBe(false);
    expect(await safeEqual("token-abc", "token-abc ")).toBe(false);
    expect(await safeEqual("", "x")).toBe(false);
    expect(await safeEqual("", "")).toBe(true);
    expect(await safeEqual("é", "e")).toBe(false);
  });
});

const respond = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkResendKey", () => {
  it("accepts a key Resend answers with 200", async () => {
    expect(await checkResendKey("re_ok", respond(200, { data: [] }))).toEqual({ ok: true });
  });

  it("accepts a sending-only key, which Resend reports as restricted", async () => {
    expect(await checkResendKey("re_send", respond(401, { name: "restricted_api_key" }))).toEqual({ ok: true });
  });

  it("rejects a key Resend does not recognise", async () => {
    expect(await checkResendKey("re_bad", respond(401, { name: "invalid_api_key" }))).toEqual({ ok: false, reason: "invalid" });
    expect(await checkResendKey("re_bad", respond(403, {}))).toEqual({ ok: false, reason: "invalid" });
    expect(await checkResendKey("re_bad", respond(400, {}))).toEqual({ ok: false, reason: "invalid" });
  });

  it("says unreachable, not invalid, when Resend is down or the network fails", async () => {
    expect(await checkResendKey("re_x", respond(500))).toEqual({ ok: false, reason: "unreachable" });
    expect(await checkResendKey("re_x", respond(429))).toEqual({ ok: false, reason: "unreachable" });
    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await checkResendKey("re_x", boom)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("sends the key as a bearer token to the domains endpoint", async () => {
    let seen: { url: string; auth: string | null } = { url: "", auth: null };
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await checkResendKey("re_secret", spy);
    expect(seen).toEqual({ url: "https://api.resend.com/domains", auth: "Bearer re_secret" });
  });
});
