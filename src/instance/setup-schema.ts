// Validation for the /setup form, shared by the browser (per step) and the server (final check).
// Rules come from docs/PRD.md sections 4, 5 and 8.1.

import { z } from "zod";
import { parseHex } from "@/lib/color";
import { validateUsername } from "@/lib/username";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const setupObject = z.object({
    // Step 1: prove ownership
    token: z.string().min(1, "Enter the setup token"),

    // Step 2: admin account
    firstName: z.string().trim().min(1, "Enter your first name").max(50, "Use 50 characters or fewer"),
    lastName: z.string().trim().min(1, "Enter your last name").max(50, "Use 50 characters or fewer"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "That email is too long")
      .pipe(z.email("Enter a valid email address")),
    username: z.string(),
    password: z.string().min(8, "Use at least 8 characters").max(128, "Use 128 characters or fewer"),

    // Step 3: identity
    name: z.string().trim().min(1, "Enter a name").max(30, "Use 30 characters or fewer"),

    // Step 4: look
    primary: z.string().refine((v) => parseHex(v) !== null, "Pick a colour"),
    radius: z.enum(RADIUS_OPTIONS),
    fontFamily: z.enum(FONT_OPTIONS),
    avatarStyle: z.enum(AVATAR_STYLES),

    // Step 5: email (optional)
    resendApiKey: optionalText(200),
    resendFrom: optionalText(254),

    // Step 6: optional services
    klipyApiKey: optionalText(200),
    placesEnabled: z.boolean(),
});

type CrossFields = { username?: unknown; name?: unknown; resendApiKey?: unknown; resendFrom?: unknown };

/** Rules that look at more than one field. Run on their own so one bad field never hides them. */
function crossFieldErrors(v: CrossFields): Record<string, string> {
  const errors: Record<string, string> = {};
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  const resendApiKey = text(v.resendApiKey).trim();
  const resendFrom = text(v.resendFrom).trim();

  if (typeof v.username === "string") {
    const result = validateUsername(v.username, { instanceName: text(v.name) });
    if (!result.ok) {
      errors.username = {
        length: "Use 3 to 15 characters",
        characters: "Use only letters, numbers and underscores",
        reserved: "That username is reserved",
      }[result.reason];
    }
  } else {
    errors.username = "Choose a username";
  }
  if (resendApiKey && !resendApiKey.startsWith("re_")) errors.resendApiKey = "A Resend key starts with re_";
  if (resendApiKey && !resendFrom) errors.resendFrom = "Enter the address emails are sent from";
  if (resendFrom && !z.email().safeParse(resendFrom).success) errors.resendFrom = "Enter a valid email address";
  return errors;
}

export type SetupInput = z.input<typeof setupObject>;
export type SetupData = z.output<typeof setupObject>;

export type SetupValidation =
  | { success: true; data: SetupData }
  | { success: false; errors: Record<string, string> };

/** Validates the whole form. Every problem is reported at once, one message per field. */
export function validateSetup(raw: unknown): SetupValidation {
  const parsed = setupObject.safeParse(raw);
  const errors = {
    ...crossFieldErrors((raw ?? {}) as CrossFields),
    ...(parsed.success ? {} : fieldErrors(parsed.error)),
  };
  if (parsed.success && Object.keys(errors).length === 0) return { success: true, data: parsed.data };
  return { success: false, errors };
}

/** Which form fields belong to each step, for per-step validation in the browser. */
export const STEP_FIELDS = {
  token: ["token"],
  admin: ["firstName", "lastName", "email", "username", "password"],
  identity: ["name"],
  look: ["primary", "radius", "fontFamily", "avatarStyle"],
  email: ["resendApiKey", "resendFrom"],
  services: ["klipyApiKey", "placesEnabled"],
} as const;

export type StepId = keyof typeof STEP_FIELDS;

/** Turns zod issues into one message per field. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
