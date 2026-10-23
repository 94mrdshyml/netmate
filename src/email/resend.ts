// Checks a Resend API key with a real call (docs/PRD.md section 4, step 5).

export type ResendCheck = { ok: true } | { ok: false; reason: "invalid" | "unreachable" };

/**
 * Lists domains, which only a full-access key may do. A sending-only key is answered with
 * `restricted_api_key`, which still proves the key is real, so that counts as valid.
 */
export async function checkResendKey(key: string, fetchFn: typeof fetch = fetch): Promise<ResendCheck> {
  try {
    const res = await fetchFn("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      const body = (await res.json().catch(() => null)) as { name?: string } | null;
      return body?.name === "restricted_api_key" ? { ok: true } : { ok: false, reason: "invalid" };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, reason: "unreachable" };
    return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
