import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const KEY = "k".repeat(40);
const OTHER_KEY = "z".repeat(40);

describe("secrets", () => {
  it("round-trips a value", async () => {
    const stored = await encryptSecret("re_live_abc123", "resend_api_key", KEY);
    expect(await decryptSecret(stored, "resend_api_key", KEY)).toBe("re_live_abc123");
  });

  it("round-trips unicode and an empty string", async () => {
    for (const value of ["", "pässwörd 🔑 日本語"]) {
      const stored = await encryptSecret(value, "klipy_api_key", KEY);
      expect(await decryptSecret(stored, "klipy_api_key", KEY)).toBe(value);
    }
  });

  it("stores a versioned, non-readable form", async () => {
    const stored = await encryptSecret("re_live_abc123", "resend_api_key", KEY);
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain("re_live_abc123");
  });

  it("uses a fresh nonce each time, so the same value never encrypts the same way", async () => {
    const a = await encryptSecret("same", "resend_api_key", KEY);
    const b = await encryptSecret("same", "resend_api_key", KEY);
    expect(a).not.toBe(b);
  });

  it("fails with the wrong key", async () => {
    const stored = await encryptSecret("secret", "resend_api_key", KEY);
    await expect(decryptSecret(stored, "resend_api_key", OTHER_KEY)).rejects.toThrow(/Could not decrypt/);
  });

  it("fails when a value is moved to another secret's row", async () => {
    const stored = await encryptSecret("secret", "resend_api_key", KEY);
    await expect(decryptSecret(stored, "klipy_api_key", KEY)).rejects.toThrow(/Could not decrypt/);
  });

  it("fails when the stored value was altered", async () => {
    const stored = await encryptSecret("secret", "resend_api_key", KEY);
    const [v, nonce, sealed] = stored.split(":") as [string, string, string];
    const flipped = (sealed[0] === "A" ? "B" : "A") + sealed.slice(1);
    await expect(decryptSecret(`${v}:${nonce}:${flipped}`, "resend_api_key", KEY)).rejects.toThrow(/Could not decrypt/);
  });

  it("rejects unknown formats and short keys", async () => {
    await expect(decryptSecret("plaintext", "resend_api_key", KEY)).rejects.toThrow(/Unrecognised/);
    await expect(decryptSecret("v2:aa:bb", "resend_api_key", KEY)).rejects.toThrow(/Unrecognised/);
    await expect(encryptSecret("x", "resend_api_key", "short")).rejects.toThrow(RangeError);
    await expect(decryptSecret("v1:aa:bb", "resend_api_key", "short")).rejects.toThrow(RangeError);
  });
});
