// Place suggestions from OpenStreetMap through the free Photon service (docs/PRD.md section 8.4 and
// 13). Called from our server, never from a member's phone, so Photon sees our server and the
// typed words but not who typed them. Streets and house numbers are left out: a post says "Berlin,
// Germany", not where someone lives. Nothing here is logged or stored.

import { z } from "zod";
import { PLACE_MAX } from "@/lib/place";

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const PHOTON_TIMEOUT_MS = 3000;
export const SUGGESTION_MAX = 6;
export const QUERY_MIN = 2;
export const QUERY_MAX = 60;

// Towns and bigger. Photon's other layers ("house", "street", "other") are never asked for.
const LAYERS = ["locality", "district", "city", "county", "state", "country"] as const;

export type PlaceSuggestion = { label: string };
export type PlaceSearch = { ok: true; places: PlaceSuggestion[] } | { ok: false };
export type PlaceSearcher = (query: string) => Promise<PlaceSearch>;

const properties = z.object({
  name: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  type: z.string().optional(),
});
const answer = z.object({ features: z.array(z.object({ properties })) });

/** "Bengaluru, Karnataka, India": the name, its state and its country, with repeats left out and at most 60 characters. */
export function placeLabel(p: z.infer<typeof properties>): string | null {
  if (!p.name || p.type === "house" || p.type === "street") return null;
  const parts = [p.name, p.state, p.country].map((x) => x?.replace(/\s+/g, " ").trim()).filter((x): x is string => Boolean(x));
  const unique = parts.filter((x, i) => x !== parts[i - 1]);
  // Too long: leave out the state first, then cut.
  let label = unique.join(", ");
  if (Array.from(label).length > PLACE_MAX && unique.length === 3) label = [unique[0], unique[2]].join(", ");
  if (Array.from(label).length > PLACE_MAX) label = Array.from(label).slice(0, PLACE_MAX).join("").trim();
  return label === "" ? null : label;
}

/** Asks Photon for places that match what was typed. Any problem (slow, down, odd answer) is just `ok: false`. */
export async function searchPhoton(query: string, fetchFn: typeof fetch = fetch): Promise<PlaceSearch> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query.slice(0, QUERY_MAX));
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "en");
  for (const layer of LAYERS) url.searchParams.append("layer", layer);
  try {
    const res = await fetchFn(url, {
      headers: { Accept: "application/json", "User-Agent": "netmate-self-hosted place suggestions" },
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const parsed = answer.safeParse(await res.json());
    if (!parsed.success) return { ok: false };
    const seen = new Set<string>();
    const places: PlaceSuggestion[] = [];
    for (const feature of parsed.data.features) {
      const label = placeLabel(feature.properties);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      places.push({ label });
      if (places.length === SUGGESTION_MAX) break;
    }
    return { ok: true, places };
  } catch {
    return { ok: false };
  }
}

// A small fixed list for the browser tests: they never reach Photon. Used only when ENV=test.
const FAKE_PLACES = [
  "Berlin, Germany",
  "Bergen, Norway",
  "Bengaluru, Karnataka, India",
  "Barcelona, Catalonia, Spain",
  "Lisbon, Portugal",
  "Lima, Peru",
  "Nairobi, Kenya",
  "Oslo, Norway",
];

export const fakeSearch: PlaceSearcher = async (query) => {
  const q = query.trim().toLowerCase();
  // Typing "offline" pretends Photon is down, so the plain text fallback can be tested.
  if (q.includes("offline")) return { ok: false };
  return { ok: true, places: FAKE_PLACES.filter((p) => p.toLowerCase().includes(q)).slice(0, SUGGESTION_MAX).map((label) => ({ label })) };
};

/** The real search, or the fake one only when the Worker was started with ENV=test (production never sets it). */
export function searcherFor(env: { ENV?: string }): PlaceSearcher {
  return env.ENV === "test" ? fakeSearch : (query) => searchPhoton(query);
}
