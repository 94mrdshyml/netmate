// Saving the look and name of the instance from /hq (docs/PRD.md section 5). The same rules as
// /setup, so a value that setup would refuse can never be saved here either.

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { instance } from "@/db/schema";
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

export type BrandingResult = { ok: true } | { ok: false; code: "invalid" | "failed"; fieldErrors: Record<string, string> };

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
