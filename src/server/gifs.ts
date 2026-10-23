// GIF search settings (docs/PRD.md sections 8.2 and 13). The Klipy key is stored encrypted in
// `instance_secrets`, like the Resend key. Unlike that one, Klipy puts the key in the address of every
// search and requires searches to come from the member's own browser, so a signed-in member's browser is
// given the key while GIF search is on (CLAUDE.md rule 3). It is never logged and never shown back in /hq.

import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { instance, instanceSecrets } from "@/db/schema";
import { KLIPY_KEY_PATTERN } from "@/lib/gif";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const KEY = "klipy_api_key";

/** The key for a member's browser, only while the admin has GIF search on. Null in every other case. */
export async function readKlipyKey(db: Db, encryptionKey: string | undefined): Promise<string | null> {
  if (!encryptionKey) return null;
  try {
    const on = await db.select({ gifsEnabled: instance.gifsEnabled }).from(instance).where(eq(instance.id, "singleton")).get();
    if (!on?.gifsEnabled) return null;
    const row = await db.select({ value: instanceSecrets.value }).from(instanceSecrets).where(eq(instanceSecrets.name, KEY)).get();
    if (!row) return null;
    return await decryptSecret(row.value, KEY, encryptionKey);
  } catch {
    return null;
  }
}

export type GifPanel = { state: "off" | "on" | "unreadable" };

/** What /hq/services shows. Never the key itself. */
export async function gifPanel(db: Db, encryptionKey: string | undefined): Promise<GifPanel> {
  const on = await db.select({ gifsEnabled: instance.gifsEnabled }).from(instance).where(eq(instance.id, "singleton")).get();
  const row = await db.select({ value: instanceSecrets.value }).from(instanceSecrets).where(eq(instanceSecrets.name, KEY)).get();
  if (!on?.gifsEnabled || !row) return { state: "off" };
  return { state: (await readKlipyKey(db, encryptionKey)) ? "on" : "unreadable" };
}

export type SaveKlipyResult = { ok: true } | { ok: false; message: string };

/** Saves a new key and turns GIF search on, in one batch. The admin's browser has already tried the key with Klipy. */
export async function saveKlipyKey(db: Db, encryptionKey: string | undefined, raw: unknown): Promise<SaveKlipyResult> {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key === "") return { ok: false, message: "Enter your Klipy key." };
  if (!KLIPY_KEY_PATTERN.test(key)) return { ok: false, message: "That does not look like a Klipy key. It has only letters, numbers, dashes and underscores." };
  if (!encryptionKey) return { ok: false, message: "This server cannot store keys safely yet. Ask whoever runs it to set SETTINGS_ENCRYPTION_KEY." };
  try {
    const value = await encryptSecret(key, KEY, encryptionKey);
    await db.batch([
      db.insert(instanceSecrets).values({ name: KEY, value }).onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } }),
      db.update(instance).set({ gifsEnabled: true, updatedAt: new Date() }).where(eq(instance.id, "singleton")),
    ]);
  } catch {
    return { ok: false, message: "Could not save the key. Try again." };
  }
  return { ok: true };
}

/** Forgets the key and turns GIF search off. GIFs already on posts stay (they are just addresses). */
export async function removeKlipyKey(db: Db): Promise<boolean> {
  try {
    await db.batch([
      db.delete(instanceSecrets).where(eq(instanceSecrets.name, KEY)),
      db.update(instance).set({ gifsEnabled: false, updatedAt: new Date() }).where(eq(instance.id, "singleton")),
    ]);
    return true;
  } catch {
    return false;
  }
}
