// Saving the look and name of the instance from /hq (docs/PRD.md section 5). The same rules as
// /setup, so a value that setup would refuse can never be saved here either.

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { instance } from "@/db/schema";
import { hostFont } from "@/instance/fonts";
import { isBrandFileAttachable, removeBrandFile } from "@/storage/brand-files";
import { parseHex } from "@/lib/color";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";

const brandingObject = z.object({
  name: z.string().trim().min(1, "Enter a name").max(30, "Use 30 characters or fewer"),
  primary: z
    .string()
    .trim()
    .refine((v) => parseHex(v) !== null, "Pick a colour"),
  radius: z.enum(RADIUS_OPTIONS, "Pick a corner style"),
  fontFamily: z.enum(FONT_OPTIONS, "Pick a font from the list"),
  avatarStyle: z.enum(AVATAR_STYLES, "Pick an avatar style"),
});

export type BrandingInput = z.input<typeof brandingObject>;
export type BrandingData = z.output<typeof brandingObject>;

/** `warning` is set when everything was saved but the font could not be downloaded. */
export type BrandingResult = { ok: true; warning?: string } | { ok: false; code: "invalid" | "failed"; fieldErrors: Record<string, string> };

/** Saves name, colour, corner style, font and default avatar style in one statement. */
export async function saveBranding(db: Db, raw: unknown): Promise<BrandingResult> {
  const parsed = brandingObject.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    return { ok: false, code: "invalid", fieldErrors };
  }
  const d = parsed.data;
  try {
    const rows = await db
      .update(instance)
      .set({ name: d.name, primaryColor: d.primary, radius: d.radius, fontFamily: d.fontFamily, avatarStyle: d.avatarStyle, updatedAt: new Date() })
      .where(eq(instance.id, "singleton"))
      .returning({ id: instance.id });
    // No row means the instance is not set up; there is nothing to save to.
    if (rows.length === 0) return { ok: false, code: "failed", fieldErrors: {} };
  } catch {
    return { ok: false, code: "failed", fieldErrors: {} };
  }
  return { ok: true };
}

const filesObject = z.object({
  logoKey: z.string().max(200).nullable().optional(),
  faviconKey: z.string().max(200).nullable().optional(),
});

/**
 * Saves the whole branding form: the five fields, the logo and favicon, and the hosted font.
 * A logo or favicon key is checked again before it is attached (undefined leaves the file alone,
 * null removes it). If the font cannot be downloaded the rest is still saved, with a warning, and
 * saving again tries once more.
 */
export async function saveBrandingForm(
  db: Db,
  bucket: R2Bucket,
  raw: unknown,
  fetcher?: Parameters<typeof hostFont>[3],
): Promise<BrandingResult> {
  const files = filesObject.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!files.success) return { ok: false, code: "invalid", fieldErrors: { logoKey: "Upload the file again" } };

  const current = await db.select({ logoKey: instance.logoKey, faviconKey: instance.faviconKey, font: instance.fontFamily }).from(instance).where(eq(instance.id, "singleton")).get();
  if (!current) return { ok: false, code: "failed", fieldErrors: {} };

  const wanted = {
    logo: files.data.logoKey === undefined ? current.logoKey : files.data.logoKey,
    favicon: files.data.faviconKey === undefined ? current.faviconKey : files.data.faviconKey,
  };
  const fieldErrors: Record<string, string> = {};
  if (wanted.logo && wanted.logo !== current.logoKey && !(await isBrandFileAttachable(bucket, "logo", wanted.logo))) fieldErrors.logoKey = "Upload the logo again";
  if (wanted.favicon && wanted.favicon !== current.faviconKey && !(await isBrandFileAttachable(bucket, "favicon", wanted.favicon))) fieldErrors.faviconKey = "Upload the favicon again";

  // A file that cannot be attached stops the whole save, so nothing is half applied.
  if (Object.keys(fieldErrors).length > 0) return { ok: false, code: "invalid", fieldErrors };

  const fields = await saveBranding(db, raw);
  if (!fields.ok) return fields;

  if (wanted.logo !== current.logoKey || wanted.favicon !== current.faviconKey) {
    try {
      await db.update(instance).set({ logoKey: wanted.logo, faviconKey: wanted.favicon, updatedAt: new Date() }).where(eq(instance.id, "singleton"));
    } catch {
      return { ok: false, code: "failed", fieldErrors: {} };
    }
    // Only after the row points at the new files is it safe to drop the old ones.
    if (current.logoKey !== wanted.logo) await removeBrandFile(bucket, current.logoKey);
    if (current.faviconKey !== wanted.favicon) await removeBrandFile(bucket, current.faviconKey);
  }

  const family = parsed(raw);
  const font = family ? await hostFont(db, bucket, family, fetcher) : null;
  return font && !font.ok ? { ok: true, warning: font.message } : { ok: true };
}

function parsed(raw: unknown): string | null {
  const family = (raw as { fontFamily?: unknown } | null)?.fontFamily;
  return typeof family === "string" ? family : null;
}
