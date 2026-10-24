import { describe, expect, it } from "vitest";
import { polarMessage } from "@/payments/polar";
import { readWebhookHeaders, verifyWebhook } from "@/payments/webhook";

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function sign(key: Uint8Array<ArrayBuffer>, id: string, ts: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`${id}.${ts}.${body}`))));
}

const NOW = 1_800_000_000_000;
const ts = String(NOW / 1000);
const body = JSON.stringify({ type: "order.paid", data: { id: "x" } });
const raw = crypto.getRandomValues(new Uint8Array(24));
const newStyle = `whsec_${b64(raw)}`; // the key is the decoded part after the prefix
const oldStyle = `whsec_${"older style!".repeat(3)}`; // not base64, so only the plain bytes can be its key

describe("verifyWebhook", () => {
  it("accepts a newer secret, signed with the decoded key", async () => {
    const sig = await sign(raw as Uint8Array<ArrayBuffer>, "msg_1", ts, body);
    expect(await verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, newStyle, NOW)).toBe(true);
  });

  it("accepts an older secret, signed with the plain bytes of the whole text", async () => {
    const sig = await sign(enc.encode(oldStyle), "msg_2", ts, body);
    expect(await verifyWebhook(body, { id: "msg_2", timestamp: ts, signature: `v1,${sig}` }, oldStyle, NOW)).toBe(true);
    // A newer-looking secret whose key is also its plain bytes (what Polar's older secrets did) works too.
    const sig2 = await sign(enc.encode(newStyle), "msg_3", ts, body);
    expect(await verifyWebhook(body, { id: "msg_3", timestamp: ts, signature: `v1,${sig2}` }, newStyle, NOW)).toBe(true);
  });

  it("accepts any one of several signatures, and ignores other versions", async () => {
    const good = await sign(raw as Uint8Array<ArrayBuffer>, "msg_4", ts, body);
    expect(await verifyWebhook(body, { id: "msg_4", timestamp: ts, signature: `v2,AAAA v1,${b64(enc.encode("nope"))} v1,${good}` }, newStyle, NOW)).toBe(true);
  });

  it("refuses a changed body, id, timestamp or secret", async () => {
    const sig = await sign(raw as Uint8Array<ArrayBuffer>, "msg_5", ts, body);
    const h = { id: "msg_5", timestamp: ts, signature: `v1,${sig}` };
    expect(await verifyWebhook(body, h, newStyle, NOW)).toBe(true);
    expect(await verifyWebhook(`${body} `, h, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...h, id: "msg_6" }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...h, timestamp: String(NOW / 1000 + 1) }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, h, `whsec_${b64(crypto.getRandomValues(new Uint8Array(24)))}`, NOW)).toBe(false);
  });

  it("refuses an old or future timestamp, even with a good signature", async () => {
    for (const offset of [-301, 301, -86_400, 86_400]) {
      const stamp = String(NOW / 1000 + offset);
      const sig = await sign(raw as Uint8Array<ArrayBuffer>, "msg_7", stamp, body);
      expect(await verifyWebhook(body, { id: "msg_7", timestamp: stamp, signature: `v1,${sig}` }, newStyle, NOW), String(offset)).toBe(false);
    }
    const stamp = String(NOW / 1000 - 299);
    const sig = await sign(raw as Uint8Array<ArrayBuffer>, "msg_8", stamp, body);
    expect(await verifyWebhook(body, { id: "msg_8", timestamp: stamp, signature: `v1,${sig}` }, newStyle, NOW)).toBe(true);
  });

  it("refuses anything missing or malformed, without throwing", async () => {
    const sig = await sign(raw as Uint8Array<ArrayBuffer>, "msg_9", ts, body);
    const good = { id: "msg_9", timestamp: ts, signature: `v1,${sig}` };
    expect(await verifyWebhook(body, { ...good, id: null }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...good, timestamp: null }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...good, signature: null }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...good, timestamp: "soon" }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...good, signature: "v1" }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, { ...good, signature: "v1,%%%not base64%%%" }, newStyle, NOW)).toBe(false);
    expect(await verifyWebhook(body, good, "", NOW)).toBe(false);
    expect(await verifyWebhook("", good, newStyle, NOW)).toBe(false);
  });

  it("reads the three headers by their names", () => {
    const h = new Headers({ "webhook-id": "a", "webhook-timestamp": "1", "webhook-signature": "v1,x" });
    expect(readWebhookHeaders(h)).toEqual({ id: "a", timestamp: "1", signature: "v1,x" });
    expect(readWebhookHeaders(new Headers())).toEqual({ id: null, timestamp: null, signature: null });
  });
});

describe("polarMessage", () => {
  it("says plainly what went wrong", () => {
    expect(polarMessage(401, null, "tok")).toBe("Polar did not accept that access token.");
    expect(polarMessage(403, { detail: "Missing scope" }, "tok")).toContain("missing a permission");
    expect(polarMessage(500, null, "tok")).toBe("Polar answered 500.");
    expect(polarMessage(422, { detail: [{ msg: "bad a", loc: [] }, { msg: "bad b" }] }, "tok")).toBe("Polar answered 422: bad a; bad b");
  });

  it("never repeats the token, and keeps it short", () => {
    const token = `polar_oat_${"secret".repeat(3)}`;
    const text = polarMessage(400, { detail: `token ${token} is wrong ${"x".repeat(500)}` }, token);
    expect(text).not.toContain(token);
    expect(text).toContain("[removed]");
    expect(text.length).toBeLessThan(260);
  });
});
