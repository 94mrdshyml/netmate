import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { clearInstanceCache, readInstanceCached } from "@/instance/settings";

const db = getDb(env.DB);
const { instance } = schema;
const base = { id: "singleton", name: "Before Save", primaryColor: "#0B6E4F", radius: "lg", fontFamily: "Space Grotesk", avatarStyle: "thumbs" } as const;

beforeEach(async () => {
  clearInstanceCache();
  await db.delete(instance);
  await db.insert(instance).values(base);
});

afterEach(async () => {
  clearInstanceCache();
  await db.delete(instance);
});

describe("the instance settings cache", () => {
  it("keeps what it read, and forgets it when cleared", async () => {
    expect((await readInstanceCached(db)).settings.name).toBe("Before Save");
    await db.update(instance).set({ name: "After Save" });
    expect((await readInstanceCached(db)).settings.name).toBe("Before Save"); // cached on purpose
    clearInstanceCache();
    expect((await readInstanceCached(db)).settings.name).toBe("After Save");
  });

  it("is not made stale by a read that was already under way when the settings were saved", async () => {
    // A page starts loading just before the owner saves; the save clears the cache; the page's read then finishes
    // with the old settings. Those must not be kept as the fresh copy.
    const slow = readInstanceCached(db);
    await db.update(instance).set({ name: "After Save" });
    clearInstanceCache();
    expect((await slow).settings.name).toBe("Before Save"); // that page may show the old name once
    expect((await readInstanceCached(db)).settings.name).toBe("After Save"); // but the next one must not
  });
});
