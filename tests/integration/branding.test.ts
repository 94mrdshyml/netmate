import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { instance } from "@/db/schema";
import { saveBranding } from "@/instance/branding";
import { readInstance } from "@/instance/settings";
import { buildThemeCss } from "@/instance/theme";

const db = () => getDb(env.DB);

const good = { name: "Greenfield", primary: "#0B6E4F", radius: "lg", fontFamily: "Lora", avatarStyle: "rings" };

async function ensureInstance() {
  await db()
    .insert(instance)
    .values({ id: "singleton", name: "Before", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" })
    .onConflictDoNothing();
  await db().update(instance).set({ name: "Before", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" });
}

describe("saveBranding", () => {
  it("saves every field and the page theme can be built from what was saved", async () => {
    await ensureInstance();

    expect(await saveBranding(db(), good)).toEqual({ ok: true });

    const { settings } = await readInstance(db());
    expect(settings).toMatchObject({ name: "Greenfield", primaryColor: "#0B6E4F", radius: "lg", fontFamily: "Lora", avatarStyle: "rings" });
    expect(() => buildThemeCss({ primary: settings.primaryColor, radius: settings.radius, fontFamily: settings.fontFamily })).not.toThrow();
  });

  it("trims the name and the colour, and accepts a short colour", async () => {
    await ensureInstance();
    expect(await saveBranding(db(), { ...good, name: "  Spaced  ", primary: " #abc " })).toEqual({ ok: true });
    expect((await readInstance(db())).settings).toMatchObject({ name: "Spaced", primaryColor: "#abc" });
  });

  it.each([
    ["an empty name", { name: "   " }, "name"],
    ["a name over 30 characters", { name: "x".repeat(31) }, "name"],
    ["a colour name", { primary: "red" }, "primary"],
    ["a colour without the hash", { primary: "0B6E4F" }, "primary"],
    ["CSS pushed into the colour", { primary: "#fff;}body{display:none" }, "primary"],
    ["a font outside the list", { fontFamily: "Comic Sans MS" }, "fontFamily"],
    ["CSS pushed into the font", { fontFamily: 'Inter";}*{display:none' }, "fontFamily"],
    ["an unknown corner style", { radius: "huge" }, "radius"],
    ["an unknown avatar style", { avatarStyle: "robots" }, "avatarStyle"],
    ["a field of the wrong kind", { name: 42 }, "name"],
  ])("refuses %s and changes nothing", async (_label, change, field) => {
    await ensureInstance();
    const res = await saveBranding(db(), { ...good, ...change });
    expect(res).toMatchObject({ ok: false, code: "invalid", fieldErrors: { [field]: expect.any(String) } });
    expect((await readInstance(db())).settings).toMatchObject({ name: "Before", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" });
  });

  it("reports every bad field at once", async () => {
    await ensureInstance();
    const res = await saveBranding(db(), { name: "", primary: "nope", radius: "x", fontFamily: "y", avatarStyle: "z" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.fieldErrors).sort()).toEqual(["avatarStyle", "fontFamily", "name", "primary", "radius"]);
  });

  it("refuses non-object input", async () => {
    await ensureInstance();
    for (const raw of [null, undefined, "text", 5, []]) {
      expect(await saveBranding(db(), raw)).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("does not touch the invite quota or other settings", async () => {
    await ensureInstance();
    await db().update(instance).set({ inviteQuota: 7 });
    await saveBranding(db(), good);
    expect((await readInstance(db())).settings.inviteQuota).toBe(7);
  });

  it("fails plainly when the instance is not set up", async () => {
    await db().delete(instance);
    expect(await saveBranding(db(), good)).toMatchObject({ ok: false, code: "failed" });
  });
});
