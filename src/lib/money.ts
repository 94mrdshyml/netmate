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
 * Our estimate of Polar's fee on one payment: a percent in hundredths (450 is 4.50%) of the payment before tax, plus a
 * fixed amount in cents, rounded to the nearest cent. Polar's published rate is 4% plus 40 cents, and 0.5% more on
 * subscriptions; the owner sets the figures from their own Polar plan. Only ever used for the owner's own numbers, never to pay anyone.
 */
export function polarFeeCents(netCents: number, feeBp: number, fixedCents: number): number {
  const base = Math.max(0, Math.trunc(netCents));
  return Math.round((base * Math.max(0, feeBp)) / 10_000) + Math.max(0, Math.trunc(fixedCents));
}

export const FEE_BP_MAX = 2000;
export const FEE_FIXED_MAX_CENTS = 500;

/** The fee a fresh instance starts with: 4.50% plus 40 cents. */
export const DEFAULT_FEE = { feeBp: 450, feeFixedCents: 40 } as const;

/** "4.5", "4.50" or "4.5%" to hundredths of a percent (450), up to 20%. */
export function parsePercentToBp(raw: unknown): { ok: true; bp: number } | { ok: false; message: string } {
  const text = typeof raw === "string" ? raw.trim().replace(/\s*%$/, "") : "";
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, message: "Use a percent like 4.5." };
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (bp > FEE_BP_MAX) return { ok: false, message: `The most is ${FEE_BP_MAX / 100}%.` };
  return { ok: true, bp };
}

/** A dollar amount typed by a person ("12", "12.5", "$12.50") in whole cents, between `min` and `max` cents. */
export function parseDollars(raw: unknown, min: number, max: number): PriceResult {
  const text = typeof raw === "string" ? raw.trim().replace(/^\$\s*/, "") : "";
  if (text === "") return { ok: false, message: "Enter an amount." };
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, message: "Use dollars and cents, like 25 or 25.50." };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents < min) return { ok: false, message: `The smallest amount is ${formatUsd(min)}.` };
  if (cents > max) return { ok: false, message: `The largest amount is ${formatUsd(max)}.` };
  return { ok: true, cents };
}
