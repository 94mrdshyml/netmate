// What every email is built from (docs/PRD.md section 7): the instance name, PNG logo, primary
// colour, corner style and font, all from instance settings. The layout is in layout.tsx and the
// rendering in render.ts. Nothing here is hard-coded.

import type { Radius } from "@/instance/theme";

export type EmailBrand = {
  name: string;
  primary: string;
  radius: Radius;
  fontFamily: string;
  /** Absolute address of a PNG logo, or null to show the name as text (mail apps do not draw SVG). */
  logoUrl: string | null;
};

export type EmailContent = {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
};

/** A PNG logo in `instance/` as an absolute address, or null for an SVG or no logo. */
export function pngLogoUrl(origin: string | undefined, logoKey: string | null): string | null {
  if (!origin || !logoKey || !logoKey.endsWith(".png") || !logoKey.startsWith("instance/")) return null;
  try {
    const base = new URL(origin);
    return base.protocol === "https:" || base.protocol === "http:" ? `${base.origin}/media/${logoKey}` : null;
  } catch {
    return null;
  }
}

/** An absolute address on this site for an email button, or null when the site address is unknown. */
export function siteUrl(origin: string | undefined, path: string): string | null {
  if (!origin) return null;
  try {
    const base = new URL(origin);
    return base.protocol === "https:" || base.protocol === "http:" ? `${base.origin}${path}` : null;
  } catch {
    return null;
  }
}

export const isWebUrl= (url: string) => /^https?:\/\/[^\s"'<>]+$/.test(url);
