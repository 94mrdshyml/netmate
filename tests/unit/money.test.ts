import { describe, expect, it } from "vitest";
import { creatorShareCents, polarFeeCents, parseDollars, parsePercentToBp, formatUsd, isPercent, parsePrice, PRICE_MAX_CENTS, PRICE_MIN_CENTS, splitPreview } from "@/lib/money";

describe("formatUsd", () => {
  it("writes dollars and cents", () => {
    expect(formatUsd(550)).toBe("$5.50");
    expect(formatUsd(1000)).toBe("$10.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(-250)).toBe("-$2.50");
  });
});

describe("parsePrice", () => {
  it("reads the ways people type a price", () => {
    for (const [text, cents] of [["5", 500], ["5.5", 550], ["5.50", 550], ["$5.50", 550], ["$ 5", 500], [" 12.05 ", 1205], ["1", 100], ["100", 10_000], ["0.99", -1]] as const) {
      const r = parsePrice(text);
      if (cents === -1) expect(r.ok, text).toBe(false);
      else expect(r, text).toEqual({ ok: true, cents });
    }
  });

  it("keeps to the allowed range and whole cents", () => {
    expect(parsePrice("0.99")).toMatchObject({ ok: false });
    expect(parsePrice("100.01")).toMatchObject({ ok: false });
    expect(parsePrice("5.555")).toMatchObject({ ok: false });
    expect(parsePrice("-5")).toMatchObject({ ok: false });
    expect(parsePrice("5,50")).toMatchObject({ ok: false });
    expect(parsePrice("five")).toMatchObject({ ok: false });
    expect(parsePrice("")).toMatchObject({ ok: false });
    expect(parsePrice(null)).toMatchObject({ ok: false });
    expect(parsePrice("1e3")).toMatchObject({ ok: false });
    expect(PRICE_MIN_CENTS).toBe(100);
    expect(PRICE_MAX_CENTS).toBe(10_000);
  });

  it("says which end is the problem, in plain words", () => {
    expect((parsePrice("0.5") as { message: string }).message).toBe("The lowest price is $1.00 a month.");
    expect((parsePrice("500") as { message: string }).message).toBe("The highest price is $100.00 a month.");
  });
});

describe("the split", () => {
  it("is a percent of the payment before tax, rounded down", () => {
    expect(creatorShareCents(1000, 0, 55)).toBe(550); // the owner's own example: $10 at 55% is $5.50
    expect(creatorShareCents(1000, 0, 0)).toBe(0);
    expect(creatorShareCents(1000, 0, 100)).toBe(1000);
    expect(creatorShareCents(999, 0, 55)).toBe(549); // 549.45 rounds down
    expect(creatorShareCents(1, 0, 55)).toBe(0);
  });

  it("takes a refund back in the same proportion", () => {
    expect(creatorShareCents(1000, 1000, 55)).toBe(0);
    expect(creatorShareCents(1000, 500, 55)).toBe(275);
    expect(creatorShareCents(1000, 5000, 55)).toBe(0); // never below zero
    expect(creatorShareCents(1000, -100, 55)).toBe(550); // a negative refund is nothing
  });

  it("never pays out more than was paid, for any price and any percent", () => {
    for (const price of [100, 101, 333, 999, 1000, 1999, 10_000]) {
      for (let pct = 0; pct <= 100; pct += 7) {
        const { creator, owner } = splitPreview(price, pct);
        expect(creator + owner).toBe(price);
        expect(creator).toBeGreaterThanOrEqual(0);
        expect(owner).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("refuses a percent that is not 0 to 100", () => {
    for (const bad of [-1, 101, 55.5, NaN, "55", null]) {
      expect(isPercent(bad), String(bad)).toBe(false);
      expect(creatorShareCents(1000, 0, bad as number)).toBe(0);
    }
  });

  it("estimates Polar's fee from the owner's own rate", () => {
    expect(polarFeeCents(1000, 450, 40)).toBe(85); // 4.50% of $10 plus 40 cents
    expect(polarFeeCents(0, 450, 40)).toBe(40);
    expect(polarFeeCents(999, 500, 50)).toBe(100); // 49.95 rounds to 50, plus 50
    expect(polarFeeCents(1000, 0, 0)).toBe(0);
    expect(polarFeeCents(-5, 450, 40)).toBe(40); // never negative
  });
});

describe("amounts typed by the owner", () => {
  it("reads a fee percent in hundredths, up to 20%", () => {
    for (const [text, bp] of [["4.5", 450], ["4.50", 450], ["4", 400], ["4.5%", 450], [" 0 ", 0], ["20", 2000], ["0.05", 5]] as const) expect(parsePercentToBp(text), text).toEqual({ ok: true, bp });
    for (const bad of ["20.01", "21", "-1", "abc", "", "4.555", "4,5", null]) expect(parsePercentToBp(bad), String(bad)).toMatchObject({ ok: false });
  });

  it("reads a dollar amount between a smallest and a largest", () => {
    expect(parseDollars("25", 1, 100_000)).toEqual({ ok: true, cents: 2500 });
    expect(parseDollars("$25.5", 1, 100_000)).toEqual({ ok: true, cents: 2550 });
    expect(parseDollars("0.01", 1, 100_000)).toEqual({ ok: true, cents: 1 });
    expect(parseDollars("0", 0, 500)).toEqual({ ok: true, cents: 0 });
    for (const bad of ["0", "0.001", "-3", "1e3", "", "ten", null]) expect(parseDollars(bad, 1, 100_000), String(bad)).toMatchObject({ ok: false });
    expect(parseDollars("1001", 1, 100_000)).toMatchObject({ ok: false, message: "The largest amount is $1,000.00." });
  });
});
