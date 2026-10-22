// Turns instance branding settings into CSS variables (docs/PRD.md section 5).
// Everything that reaches the stylesheet is validated here, so a setting can never
// inject CSS or script.

import {
  BLACK,
  WHITE,
  contrastRatio,
  ensureContrast,
  parseHex,
  readableOn,
  rgbToOklch,
  oklchToRgb,
  toHex,
  type Rgb,
} from "@/lib/color";

export const RADII = {
  zero: "0px",
  sm: "4px",
  md: "8px",
  lg: "16px",
} as const;

export type Radius = keyof typeof RADII;

export type ThemeSettings = {
  /** Brand colour as #rgb or #rrggbb. */
  primary: string;
  radius: Radius;
  /** A font family name such as "Inter". Letters, digits and spaces only. */
  fontFamily: string;
};

/** Minimum contrast: 4.5 for text (WCAG AA), 3 for the button fill against the page. */
export const TEXT_CONTRAST = 4.5;
export const FILL_CONTRAST = 3;

type ModeTokens = {
  bg: string;
  fg: string;
  brand: string;
  onBrand: string;
  brandHover: string;
  brandPressed: string;
  /** Brand-coloured text and links on the page background. */
  brandText: string;
};

export type DerivedTheme = {
  light: ModeTokens;
  dark: ModeTokens;
  /** True when the chosen colour had to be changed in a mode to stay readable. */
  adjusted: { light: boolean; dark: boolean };
};

const PAGE = {
  light: { bg: WHITE, fg: { r: 15, g: 15, b: 15 } },
  dark: { bg: BLACK, fg: { r: 245, g: 245, b: 245 } },
} as const;

function shift(rgb: Rgb, delta: number): Rgb {
  const o = rgbToOklch(rgb);
  return oklchToRgb({ ...o, l: Math.min(1, Math.max(0, o.l + delta)) });
}

function deriveMode(primary: Rgb, mode: "light" | "dark"): { tokens: ModeTokens; adjusted: boolean } {
  const { bg, fg } = PAGE[mode];

  // The button fill must stand out from the page (3:1), or the button disappears.
  const fill = ensureContrast(primary, bg, FILL_CONTRAST);
  const adjusted = toHex(fill) !== toHex(primary);

  const onFill = readableOn(fill);
  // Hover and pressed move the same way the text contrast improves, so they stay readable.
  const step = onFill === WHITE ? -1 : 1;
  const hover = shift(fill, step * 0.04);
  const pressed = shift(fill, step * 0.08);

  // Brand-coloured text on the page needs full text contrast.
  const text = ensureContrast(primary, bg, TEXT_CONTRAST);

  return {
    adjusted,
    tokens: {
      bg: toHex(bg),
      fg: toHex(fg),
      brand: toHex(fill),
      onBrand: toHex(onFill),
      brandHover: toHex(hover),
      brandPressed: toHex(pressed),
      brandText: toHex(text),
    },
  };
}

/** Derives light and dark tokens from any valid hex colour. Throws RangeError on bad input. */
export function deriveTheme(primaryHex: string): DerivedTheme {
  const primary = parseHex(primaryHex);
  if (!primary) throw new RangeError(`Not a hex colour: ${JSON.stringify(primaryHex)}`);
  const light = deriveMode(primary, "light");
  const dark = deriveMode(primary, "dark");
  return {
    light: light.tokens,
    dark: dark.tokens,
    adjusted: { light: light.adjusted, dark: dark.adjusted },
  };
}

const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;

export function isValidFontFamily(name: string): boolean {
  return FONT_NAME.test(name);
}

function modeCss(t: ModeTokens): string {
  return [
    `--bg:${t.bg}`,
    `--fg:${t.fg}`,
    `--brand:${t.brand}`,
    `--on-brand:${t.onBrand}`,
    `--brand-hover:${t.brandHover}`,
    `--brand-pressed:${t.brandPressed}`,
    `--brand-text:${t.brandText}`,
  ].join(";");
}

/**
 * Builds the stylesheet text for the page head. Light is the base; dark applies when the
 * phone prefers it (unless the member forced light) or when the member forced dark.
 */
export function buildThemeCss(settings: ThemeSettings): { css: string; adjusted: DerivedTheme["adjusted"] } {
  if (!Object.hasOwn(RADII, settings.radius)) {
    throw new RangeError(`Unknown radius: ${JSON.stringify(settings.radius)}`);
  }
  if (!isValidFontFamily(settings.fontFamily)) {
    throw new RangeError(`Invalid font family: ${JSON.stringify(settings.fontFamily)}`);
  }

  const theme = deriveTheme(settings.primary);
  const shared = `--radius:${RADII[settings.radius]};--font:"${settings.fontFamily}",system-ui,sans-serif`;
  const light = modeCss(theme.light);
  const dark = modeCss(theme.dark);

  const css =
    `:root{${shared};${light};color-scheme:light dark}` +
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}` +
    `:root[data-theme="dark"]{${dark}}`;

  return { css, adjusted: theme.adjusted };
}

/** Exposed so the admin editor can show the real contrast of a choice. */
export function contrastOf(foregroundHex: string, backgroundHex: string): number {
  const fg = parseHex(foregroundHex);
  const bg = parseHex(backgroundHex);
  if (!fg || !bg) throw new RangeError("Invalid colour");
  return contrastRatio(fg, bg);
}
