// Reads the instance row (docs/PRD.md sections 3 and 5). No row means /setup has not run yet.

import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { instance } from "@/db/schema";
import { readFontFaces, type FontFaceRow } from "@/instance/fonts";
import { DEFAULT_AVATAR_STYLE, DEFAULT_INSTANCE_NAME, DEFAULT_INVITE_QUOTA, DEFAULT_THEME } from "@/instance/defaults";
import { RADII, type Radius } from "@/instance/theme";

export type InstanceSettings = {
  name: string;
  logoKey: string | null;
  faviconKey: string | null;
  primaryColor: string;
  radius: Radius;
  fontFamily: string;
  avatarStyle: string;
  themeDefault: "dark" | "light" | "system";
  inviteQuota: number;
  gifsEnabled: boolean;
  placesEnabled: boolean;
  linkPreviewsEnabled: boolean;
};

/** `fontFaces` are the hosted files of the chosen font, read with the settings so one cache covers both. */
export type InstanceState = { configured: boolean; settings: InstanceSettings; fontFaces: FontFaceRow[] };

export const DEFAULT_SETTINGS: InstanceSettings = {
  name: DEFAULT_INSTANCE_NAME,
  logoKey: null,
  faviconKey: null,
  primaryColor: DEFAULT_THEME.primary,
  radius: DEFAULT_THEME.radius,
  fontFamily: DEFAULT_THEME.fontFamily,
  avatarStyle: DEFAULT_AVATAR_STYLE,
  themeDefault: "system",
  inviteQuota: DEFAULT_INVITE_QUOTA,
  gifsEnabled: false,
  placesEnabled: false,
  linkPreviewsEnabled: false,
};

const isRadius = (v: string): v is Radius => Object.hasOwn(RADII, v);
const isThemeDefault = (v: string): v is InstanceSettings["themeDefault"] => v === "dark" || v === "light" || v === "system";

/** Reads the instance row. Before setup it returns the defaults with `configured: false`. */
export async function readInstance(db: Db): Promise<InstanceState> {
  const row = await db.select().from(instance).where(eq(instance.id, "singleton")).get();
  if (!row) return { configured: false, settings: DEFAULT_SETTINGS, fontFaces: [] };

  return {
    configured: true,
    fontFaces: await readFontFaces(db, row.fontFamily),
    settings: {
      name: row.name,
      logoKey: row.logoKey,
      faviconKey: row.faviconKey,
      primaryColor: row.primaryColor,
      // The database CHECKs these; fall back rather than crash if one is ever wrong.
      radius: isRadius(row.radius) ? row.radius : DEFAULT_SETTINGS.radius,
      fontFamily: row.fontFamily,
      avatarStyle: row.avatarStyle,
      themeDefault: isThemeDefault(row.themeDefault) ? row.themeDefault : "system",
      inviteQuota: row.inviteQuota,
      gifsEnabled: row.gifsEnabled,
      placesEnabled: row.placesEnabled,
      linkPreviewsEnabled: row.linkPreviewsEnabled,
    },
  };
}

// Per-isolate cache: the check runs on every request (PRD section 3). Saving settings
// clears this isolate at once; other isolates catch up within the TTL.
const TTL_MS = 30_000;
let cached: { at: number; state: InstanceState } | null = null;
// Counts the times the cache was cleared. A read that started before a clear may finish after it, holding the
// settings from before the save; without this it would put them back as the fresh copy for the next 30 seconds.
let generation = 0;

export async function readInstanceCached(db: Db, now: number = Date.now()): Promise<InstanceState> {
  if (cached && now - cached.at < TTL_MS) return cached.state;
  const started = generation;
  const state = await readInstance(db);
  if (started === generation) cached = { at: now, state };
  return state;
}

export function clearInstanceCache(): void {
  generation++;
  cached = null;
}
