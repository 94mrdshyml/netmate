import { describe, expect, it, vi } from "vitest";
import { fakeSearch, PHOTON_URL, placeLabel, searcherFor, searchPhoton, SUGGESTION_MAX } from "@/places/photon";

const feature = (properties: Record<string, string>) => ({ type: "Feature", properties });
const answer = (...features: ReturnType<typeof feature>[]) => new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200 });

describe("placeLabel", () => {
  it("joins name, state and country", () => {
    expect(placeLabel({ name: "Bengaluru", state: "Karnataka", country: "India" })).toBe("Bengaluru, Karnataka, India");
  });

  it("leaves out repeats", () => {
    expect(placeLabel({ name: "Berlin", state: "Berlin", country: "Germany" })).toBe("Berlin, Germany");
    expect(placeLabel({ name: "Germany", country: "Germany", type: "country" })).toBe("Germany");
  });

  it("has nothing for a street, a house or an unnamed place", () => {
    expect(placeLabel({ name: "Hauptstrasse", type: "street" })).toBeNull();
    expect(placeLabel({ name: "12", type: "house" })).toBeNull();
    expect(placeLabel({ country: "Germany" })).toBeNull();
    expect(placeLabel({ name: "   " })).toBeNull();
  });

  it("stays within 60 characters: the state goes first, then the end is cut", () => {
    const state = "S".repeat(30);
    const label = placeLabel({ name: "Llanfairpwllgwyngyll", state, country: "United Kingdom of Great Britain" });
    expect(label).toBe("Llanfairpwllgwyngyll, United Kingdom of Great Britain");
    expect(Array.from(placeLabel({ name: "N".repeat(80), country: "C" })!).length).toBeLessThanOrEqual(60);
  });
});

describe("searchPhoton", () => {
  it("asks Photon for towns and bigger only, in English, and never for streets", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => answer());
    await searchPhoton("ber", fetchFn);
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(PHOTON_URL);
    expect(url.searchParams.get("q")).toBe("ber");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.getAll("layer")).toEqual(["locality", "district", "city", "county", "state", "country"]);
    expect(url.searchParams.getAll("layer")).not.toContain("street");
    expect(url.searchParams.getAll("layer")).not.toContain("house");
  });

  it("sends no cookies, no member details and a time limit", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => answer());
    await searchPhoton("ber", fetchFn);
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(init.headers as Record<string, string>).map((k) => k.toLowerCase()).sort()).toEqual(["accept", "user-agent"]);
    expect(init.credentials).toBeUndefined();
  });

  it("turns the answer into labels, dropping repeats and streets, at most six", async () => {
    const many = Array.from({ length: 10 }, (_, i) => feature({ name: `Town ${i}`, country: "Land" }));
    const res = await searchPhoton(
      "town",
      (async () =>
        answer(
          feature({ name: "Berlin", state: "Berlin", country: "Germany" }),
          feature({ name: "Hauptstrasse", type: "street", country: "Germany" }),
          feature({ name: "berlin", country: "germany" }),
          feature({ name: "Berlin", state: "Berlin", country: "Germany" }),
          ...many,
        )) as unknown as typeof fetch,
    );
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.places[0]).toEqual({ label: "Berlin, Germany" });
    expect(res.places.map((p) => p.label)).not.toContain("Hauptstrasse, Germany");
    expect(res.places).toHaveLength(SUGGESTION_MAX);
    // "Berlin, Germany" once, however often it came.
    expect(res.places.filter((p) => p.label.toLowerCase() === "berlin, germany")).toHaveLength(1);
  });

  it("is just 'not ok' when Photon is slow, down, refuses, or answers nonsense", async () => {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const busy = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    const odd = (async () => new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as unknown as typeof fetch;
    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    for (const f of [down, busy, odd, notJson]) expect(await searchPhoton("ber", f)).toEqual({ ok: false });
  });

  it("cuts a very long query before it is sent", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => answer());
    await searchPhoton("x".repeat(500), fetchFn);
    expect(new URL(String(fetchFn.mock.calls[0]![0])).searchParams.get("q")).toHaveLength(60);
  });
});

describe("searcherFor", () => {
  it("uses the fake only when ENV is exactly test", async () => {
    expect(searcherFor({ ENV: "test" })).toBe(fakeSearch);
  });

  it.each([undefined, "", "production", "Test", "TEST", "test ", "testing"])("uses the real search when ENV is %j, so production can never reach the fake", (value) => {
    expect(searcherFor({ ENV: value })).not.toBe(fakeSearch);
  });
});

describe("the test fake", () => {
  it("finds places by what was typed and can pretend Photon is down", async () => {
    expect(await fakeSearch("ber")).toEqual({ ok: true, places: [{ label: "Berlin, Germany" }, { label: "Bergen, Norway" }] });
    expect(await fakeSearch("BENG")).toEqual({ ok: true, places: [{ label: "Bengaluru, Karnataka, India" }] });
    expect(await fakeSearch("offline")).toEqual({ ok: false });
    expect(await fakeSearch("zzzz")).toEqual({ ok: true, places: [] });
  });
});
