import { describe, expect, it } from "vitest";
import { checkPlace, PLACE_MAX } from "@/lib/place";

describe("checkPlace", () => {
  it("means no place for nothing, empty and spaces", () => {
    for (const raw of [undefined, null, "", "   ", "\n\t "]) expect(checkPlace(raw)).toEqual({ ok: true, place: null });
  });

  it("trims and squeezes spaces", () => {
    expect(checkPlace("  Berlin,   Germany \n")).toEqual({ ok: true, place: "Berlin, Germany" });
  });

  it("keeps names in any script and counts characters, not bytes", () => {
    expect(checkPlace("東京, 日本")).toEqual({ ok: true, place: "東京, 日本" });
    expect(checkPlace("😀".repeat(PLACE_MAX))).toMatchObject({ ok: true });
    expect(checkPlace("😀".repeat(PLACE_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("allows exactly 60 characters and refuses 61", () => {
    expect(checkPlace("a".repeat(60))).toMatchObject({ ok: true });
    expect(checkPlace("a".repeat(61))).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses control characters and anything that is not text", () => {
    expect(checkPlace("Ber\u0000lin")).toEqual({ ok: false, reason: "bad_characters" });
    expect(checkPlace("Ber\u0007lin")).toEqual({ ok: false, reason: "bad_characters" });
    expect(checkPlace(42)).toEqual({ ok: false, reason: "bad_characters" });
    expect(checkPlace({ label: "Berlin" })).toEqual({ ok: false, reason: "bad_characters" });
  });

  it("keeps markup as plain text (it is only ever shown as text)", () => {
    expect(checkPlace("<b>Berlin</b>")).toEqual({ ok: true, place: "<b>Berlin</b>" });
  });
});
