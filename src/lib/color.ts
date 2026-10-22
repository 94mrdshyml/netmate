// Colour maths for instance theming: WCAG contrast plus OKLCH lightness changes,
// so any primary colour an admin picks can be made readable (docs/PRD.md section 5).

export type Rgb = { r: number; g: number; b: number }; // each 0 to 255
export type Oklch = { l: number; c: number; h: number }; // l 0..1, c >= 0, h degrees

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Accepts #rgb or #rrggbb (case-insensitive). Returns null for anything else. */
export function parseHex(input: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1] as string;
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Rounds each channel to a whole 0 to 255 value, exactly what toHex will print. */
export function quantize(rgb: Rgb): Rgb {
  return { r: Math.round(clamp(rgb.r, 0, 255)), g: Math.round(clamp(rgb.g, 0, 255)), b: Math.round(clamp(rgb.b, 0, 255)) };
}

export function toHex(rgb: Rgb): string {
  const part = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  const h = c < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = ([r, g, b]: [number, number, number]) =>
  [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005);

/** Converts back to sRGB, lowering chroma until the colour fits the screen's gamut. */
export function oklchToRgb(color: Oklch): Rgb {
  const l = clamp(color.l, 0, 1);
  let lo = 0;
  let hi = color.c;
  let best = oklchToLinear({ l, c: 0, h: color.h });
  if (inGamut(oklchToLinear({ l, c: color.c, h: color.h }))) {
    best = oklchToLinear({ l, c: color.c, h: color.h });
  } else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const candidate = oklchToLinear({ l, c: mid, h: color.h });
      if (inGamut(candidate)) {
        lo = mid;
        best = candidate;
      } else {
        hi = mid;
      }
    }
  }
  return {
    r: clamp(fromLinear(clamp(best[0], 0, 1)), 0, 255),
    g: clamp(fromLinear(clamp(best[1], 0, 1)), 0, 255),
    b: clamp(fromLinear(clamp(best[2], 0, 1)), 0, 255),
  };
}

export function withLightness(rgb: Rgb, l: number): Rgb {
  const o = rgbToOklch(rgb);
  return oklchToRgb({ ...o, l });
}

/**
 * Moves the colour's lightness away from `bg` (darker on a light page, lighter on a
 * dark one) until the contrast ratio against `bg` reaches `min`. Keeps hue, and keeps
 * as much chroma as the screen allows. Returns the colour unchanged if it already passes.
 */
export function ensureContrast(rgb: Rgb, bg: Rgb, min: number): Rgb {
  if (contrastRatio(rgb, bg) >= min) return rgb;

  const goDarker = relativeLuminance(bg) > 0.18;
  const start = rgbToOklch(rgb);
  const limit = goDarker ? 0 : 1;

  // Test real 8-bit colours: the hex we hand out is rounded, and rounding alone can
  // push a 4.50 result just under 4.5.
  const solid = (l: number) => quantize(oklchToRgb({ ...start, l }));

  // Binary search on lightness between the start and the extreme (black or white).
  let near = start.l; // fails
  let far = limit; // always passes against a black or white page
  let best = solid(far);
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    const candidate = solid(mid);
    if (contrastRatio(candidate, bg) >= min) {
      far = mid;
      best = candidate;
    } else {
      near = mid;
    }
  }
  return best;
}

/** Black or white, whichever reads better on `bg`. Always at least 4.5:1 (worst case about 4.58). */
export function readableOn(bg: Rgb): Rgb {
  return contrastRatio(BLACK, bg) >= contrastRatio(WHITE, bg) ? BLACK : WHITE;
}
