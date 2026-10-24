// Checking that a webhook really came from Polar. Polar signs with the Standard Webhooks scheme:
// three headers (webhook-id, webhook-timestamp, webhook-signature), and the signature is the base64 HMAC-SHA256 of
// `<id>.<timestamp>.<body>`. The key is either the decoded part of the `whsec_` secret after the prefix (newer
// secrets) or the plain bytes of the whole secret text (older ones); both are tried. Nothing here logs the secret
// or the body.

const TOLERANCE_MS = 5 * 60 * 1000;

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const s = atob(text);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The keys a secret may mean. */
function candidateKeys(secret: string): Uint8Array<ArrayBuffer>[] {
  const keys: Uint8Array<ArrayBuffer>[] = [];
  if (secret.startsWith("whsec_")) {
    const decoded = fromBase64(secret.slice("whsec_".length));
    if (decoded && decoded.length > 0) keys.push(decoded);
  }
  keys.push(new TextEncoder().encode(secret));
  return keys;
}

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/** The three headers, in one place so the route and the tests read them the same way. */
export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return { id: headers.get("webhook-id"), timestamp: headers.get("webhook-timestamp"), signature: headers.get("webhook-signature") };
}

/** True only when one of the signatures matches, the timestamp is within five minutes of `now`, and every part is present. */
export async function verifyWebhook(body: string, headers: WebhookHeaders, secret: string, now: number = Date.now()): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > TOLERANCE_MS) return false;

  const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const sent: Uint8Array<ArrayBuffer>[] = [];
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const bytes = fromBase64(value);
    if (bytes) sent.push(bytes);
  }
  if (sent.length === 0) return false;

  for (const raw of candidateKeys(secret)) {
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const sig of sent) {
      // `verify` compares in constant time.
      if (await crypto.subtle.verify("HMAC", key, sig, data)) return true;
    }
  }
  return false;
}
