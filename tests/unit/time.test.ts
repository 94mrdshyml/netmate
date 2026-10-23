import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/time";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it.each([
    [0, "now"],
    [59_000, "now"],
    [MIN, "1m"],
    [59 * MIN, "59m"],
    [HOUR, "1h"],
    [23 * HOUR + 59 * MIN, "23h"],
    [DAY, "1d"],
    [6 * DAY + 23 * HOUR, "6d"],
  ])("%d ms ago is %s", (ago, expected) => {
    expect(relativeTime(NOW - ago, NOW)).toBe(expected);
  });

  it("shows a date after a week, with the year only when it differs", () => {
    expect(relativeTime(Date.UTC(2026, 9, 1), NOW)).toBe("Oct 1");
    expect(relativeTime(Date.UTC(2025, 11, 31), NOW)).toBe("Dec 31, 2025");
  });

  it("never shows a negative age for a clock that is slightly ahead", () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe("now");
  });
});
