// Encrypts third-party keys (Resend, Klipy) before they go into D1 (docs/PRD.md section 13).
// AES-256-GCM with a fresh random 96-bit nonce per value. The AES key is derived from
// SETTINGS_ENCRYPTION_KEY with HKDF, so that secret can be any long random string.
// Stored form: `v1:<base64 nonce>:<base64 ciphertext+tag>`. Never log either side.

const VERSION = "v1";
const MIN_KEY_LENGTH = 32;
const INFO = new TextEncoder().encode("netmate instance secrets v1");

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function aesKey(secret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (secret.length < MIN_KEY_LENGTH) {
    throw new RangeError(`SETTINGS_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  }
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** `name` is bound to the ciphertext, so a value copied to another secret's row will not decrypt. */
export async function encryptSecret(plaintext: string, name: string, secret: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret, "encrypt");
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(name) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}:${toBase64(nonce)}:${toBase64(new Uint8Array(sealed))}`;
}

/** Throws if the value was tampered with, belongs to another name, or the key is wrong. */
export async function decryptSecret(stored: string, name: string, secret: string): Promise<string> {
  const [version, nonce, sealed] = stored.split(":");
  if (version !== VERSION || !nonce || !sealed) throw new Error("Unrecognised secret format");
  const key = await aesKey(secret, "decrypt");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(nonce), additionalData: new TextEncoder().encode(name) },
      key,
      fromBase64(sealed),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Could not decrypt the secret (wrong key, wrong name, or altered value)");
  }
}
