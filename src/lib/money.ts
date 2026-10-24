// Money for paid subscriptions (docs/PRD.md, "Paid subscriptions"). Everything is whole US cents, never a
// float. US dollars only for now. Pure, so the split and the price rules are tested without a server.

/** The one currency, in the form Polar expects. */
export const CURRENCY = "usd";

/** What a member may charge a month, in cents ($1.00 to $100.00). Polar's own minimum is lower. */
export const PRICE_MIN_CENTS = 100;
export const PRICE_MAX_CENTS = 10_000;

/** 550 -> "$5.50". Whole dollars keep their cents: "$10.00". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export type PriceResult = { ok: true; cents: number } | { ok: false; message: string };

/** A price typed by a person: "5", "5.5", "5.50" or "$5.50". Whole cents only, inside the allowed range. */
export function parsePrice(raw: unknown): PriceResult {
  const text = typeof raw === "string" ? raw.trim().replace(/^\$\s*/, "") : "";
  if (text === "") return { ok: false, message: "Enter a price." };
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, message: "Use dollars and cents, like 5 or 5.50." };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents < PRICE_MIN_CENTS) return { ok: false, message: `The lowest price is ${formatUsd(PRICE_MIN_CENTS)} a month.` };
  if (cents > PRICE_MAX_CENTS) return { ok: false, message: `The highest price is ${formatUsd(PRICE_MAX_CENTS)} a month.` };
  return { ok: true, cents };
}

/** True for a whole number from 0 to 100, the share of each payment that goes to the member. */
export function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * What a member earns from one payment. The base is the payment before tax (Polar collects the tax and pays it
 * on, so it never takes part in the split) minus anything refunded. Polar's own fee comes out of the owner's
 * share, so a member always knows what they earn. Rounds down to a whole cent, so the two shares never add up
 * to more than was paid.
 */
export function creatorShareCents(netCents: number, refundedCents: number, creatorPercent: number): number {
  if (!isPercent(creatorPercent)) return 0;
  const base = Math.max(0, Math.trunc(netCents) - Math.max(0, Math.trunc(refundedCents)));
  return Math.floor((base * creatorPercent) / 100);
}

/** The split of one monthly price, for showing what each side gets. The owner's side is before Polar's fee. */
export function splitPreview(priceCents: number, creatorPercent: number): { creator: number; owner: number } {
  const creator = creatorShareCents(priceCents, 0, creatorPercent);
  return { creator, owner: Math.max(0, priceCents) - creator };
}

/**
 * A rough guess of Polar's fee on one payment, for the owner's information only (Polar's published rate is
 * 4% plus 40 cents, and 0.5% more on subscriptions; newer accounts may pay a different rate). Never used to pay anyone.
 */
export function estimatePolarFeeCents(priceCents: number): number {
  return Math.round(Math.max(0, priceCents) * 0.045) + 40;
}
