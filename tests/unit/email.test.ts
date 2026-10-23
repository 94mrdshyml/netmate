import { beforeEach, describe, expect, it } from "vitest";
import { isWebUrl, pngLogoUrl } from "@/email/template";
import { fakeTransport, outbox, realTransport, scrubError, transportFor } from "@/email/transport";

const mail = { from: "hello@example.org", to: "ada@example.org", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

describe("scrubError", () => {
  it("removes addresses and keys so they are never stored or shown", () => {
    const text = scrubError("Invalid to ada@example.org with key re_AbC123xyz987 for hello@mail.example.org");
    expect(text).not.toContain("ada@");
    expect(text).not.toContain("example.org");
    expect(text).not.toContain("re_AbC");
    expect(text).toContain("[address]");
    expect(text).toContain("[key]");
  });

  it("keeps the rest, on one line, at most 300 characters", () => {
    expect(scrubError("The domain is\nnot   verified.")).toBe("The domain is not verified.");
    expect(scrubError("x".repeat(500))).toHaveLength(300);
  });
});

describe("transportFor", () => {
  it("uses the fake only when ENV is exactly test", () => {
    expect(transportFor({ ENV: "test" })).toBe(fakeTransport);
  });

  it.each([undefined, "", "production", "Test", "TEST", "test ", "testing"])("uses the real one when ENV is %j, so production can never reach the fake", (value) => {
    expect(transportFor({ ENV: value })).not.toBe(fakeTransport);
  });
});

describe("fakeTransport", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("keeps what it was given instead of sending", async () => {
    expect(await fakeTransport.send("re_test_1", mail)).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "ada@example.org", subject: "Hi" });
  });

  it("refuses a sender on a .invalid domain the way Resend refuses an unverified one", async () => {
    const res = await fakeTransport.send("re_test_1", { ...mail, from: "hello@nowhere.invalid" });
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining("not verified") });
    expect(outbox).toHaveLength(0);
  });

  it("accepts only keys that start re_test_", async () => {
    expect(await fakeTransport.checkKey("re_test_abc")).toEqual({ ok: true });
    expect(await fakeTransport.checkKey("re_live_abc")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("realTransport", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("posts to Resend with the key, one recipient and the content", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    expect(await realTransport(fetchFn).send("re_secret1234", mail)).toEqual({ ok: true });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_secret1234");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ from: mail.from, to: [mail.to], subject: "Hi", html: mail.html, text: "Hi" });
  });

  it("returns Resend's own words, scrubbed, when it refuses", async () => {
    const res = await realTransport(reply(403, { name: "validation_error", message: "The example.org domain is not verified for ada@example.org." })).send("re_x", mail);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) {
      expect(res.message).toContain("not verified");
      expect(res.message).not.toContain("ada@");
    }
  });

  it("says plainly when Resend is busy or the network fails, and never throws", async () => {
    expect(await realTransport(reply(429, {})).send("re_x", mail)).toMatchObject({ ok: false, message: expect.stringContaining("busy") });
    expect(await realTransport(reply(503, {})).send("re_x", mail)).toMatchObject({ ok: false });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await realTransport(down).send("re_x", mail)).toMatchObject({ ok: false, message: expect.stringContaining("Could not reach") });
    expect(await realTransport(reply(422, "not json")).send("re_x", mail)).toMatchObject({ ok: false });
  });
});

describe("pngLogoUrl", () => {
  it("builds an address only for a PNG under instance/", () => {
    expect(pngLogoUrl("https://club.example.org", "instance/abcdefghijklmnopqrstuvwx.png")).toBe("https://club.example.org/media/instance/abcdefghijklmnopqrstuvwx.png");
    expect(pngLogoUrl("https://club.example.org/x?y=1", "instance/abcdefghijklmnopqrstuvwx.png")).toBe("https://club.example.org/media/instance/abcdefghijklmnopqrstuvwx.png");
  });

  it("returns null for an SVG, no logo, no origin, a bad origin or another folder", () => {
    expect(pngLogoUrl("https://club.example.org", "instance/abcdefghijklmnopqrstuvwx.svg")).toBeNull();
    expect(pngLogoUrl("https://club.example.org", null)).toBeNull();
    expect(pngLogoUrl(undefined, "instance/abcdefghijklmnopqrstuvwx.png")).toBeNull();
    expect(pngLogoUrl("javascript:alert(1)", "instance/abcdefghijklmnopqrstuvwx.png")).toBeNull();
    expect(pngLogoUrl("not a url", "instance/abcdefghijklmnopqrstuvwx.png")).toBeNull();
    expect(pngLogoUrl("https://club.example.org", "avatars/usr_x/abcdefghijklmnopqrstuvwx.png")).toBeNull();
  });
});

describe("isWebUrl", () => {
  it("accepts http and https addresses only", () => {
    expect(isWebUrl("https://club.example.org/open?x=1")).toBe(true);
    expect(isWebUrl("http://club.example.org")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.test", 'https://x.test/"onclick="x', "https://x.test/a b", ""]) {
      expect(isWebUrl(bad)).toBe(false);
    }
  });
});
