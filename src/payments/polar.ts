// A small client for Polar's API (docs/PRD.md, "Paid subscriptions"), made with plain fetch so no package is needed.
// The access token is read from encrypted storage only for the length of a call and is never logged or returned.

export type PolarMode = "sandbox" | "production";

export const POLAR_MODES: readonly PolarMode[] = ["sandbox", "production"];

export const isPolarMode = (value: unknown): value is PolarMode => value === "sandbox" || value === "production";

const BASES: Record<PolarMode, string> = { sandbox: "https://sandbox-api.polar.sh", production: "https://api.polar.sh" };

export type PolarResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; message: string };

/** Polar's reason for a refusal in plain text, shortened, with the token taken out if it ever appears. */
export function polarMessage(status: number, body: unknown, token: string): string {
  let detail = "";
  if (body && typeof body === "object") {
    const d = (body as { detail?: unknown; error_description?: unknown; error?: unknown }).detail ?? (body as { error_description?: unknown }).error_description ?? (body as { error?: unknown }).error;
    if (typeof d === "string") detail = d;
    // A validation error is a list of { msg, loc }.
    else if (Array.isArray(d)) detail = d.map((x) => (x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string" ? (x as { msg: string }).msg : "")).filter(Boolean).join("; ");
  }
  const clean = (token ? detail.split(token).join("[removed]") : detail).replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401) return "Polar did not accept that access token.";
  if (status === 403) return `Polar refused: the token is missing a permission.${clean ? ` (${clean})` : ""}`;
  return clean ? `Polar answered ${status}: ${clean}` : `Polar answered ${status}.`;
}

/** Calls Polar. Never throws: a network failure or timeout comes back as `ok: false`. */
export async function polarCall<T = unknown>(
  mode: PolarMode,
  token: string,
  path: string,
  init: { method?: "GET" | "POST" | "PATCH"; json?: unknown; timeoutMs?: number } = {},
): Promise<PolarResult<T>> {
  try {
    const res = await fetch(`${BASES[mode]}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
      redirect: "error",
    });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) return { ok: false, status: res.status, message: polarMessage(res.status, body, token) };
    return { ok: true, status: res.status, body: body as T };
  } catch {
    return { ok: false, status: 0, message: "Could not reach Polar. Try again in a moment." };
  }
}
