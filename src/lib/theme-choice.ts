// The member's light or dark choice (docs/PRD.md section 8.13). It lives in a plain cookie so the
// server can set the right theme on the very first paint. The cookie holds nothing about the person.

export const THEME_COOKIE = "nm-theme";
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function parseThemeChoice(value: unknown): ThemeChoice | null {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value) ? (value as ThemeChoice) : null;
}

/**
 * The `data-theme` value for the page: the member's own choice first, then the instance default.
 * `null` means "follow the phone", which the stylesheet does when the attribute is absent.
 */
export function themeAttribute(cookie: unknown, instanceDefault: ThemeChoice): "light" | "dark" | null {
  const choice = parseThemeChoice(cookie) ?? instanceDefault;
  return choice === "system" ? null : choice;
}
