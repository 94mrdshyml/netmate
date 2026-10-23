// The look shared by every email (docs/PRD.md section 7): the instance name, PNG logo, primary
// colour, corner style and font, all from instance settings. Mail apps ignore CSS variables and
// web fonts, so colours are written out and the font has plain fallbacks. Nothing is hard-coded.

import { deriveTheme, RADII, type Radius } from "@/instance/theme";

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

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

const isWebUrl = (url: string) => /^https?:\/\/[^\s"'<>]+$/.test(url);

export function brandedEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  const light = deriveTheme(brand.primary).light;
  const radius = RADII[brand.radius];
  // The family name was checked against the font list; keep only safe characters regardless.
  const family = brand.fontFamily.replace(/[^A-Za-z0-9 ]/g, "");
  const font = `'${family}', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
  const name = escapeHtml(brand.name);

  const head = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="32" style="display:block;height:32px;width:auto;border:0">`
    : `<span style="font-size:20px;font-weight:700;color:${light.brandText}">${name}</span>`;

  const button =
    content.button && isWebUrl(content.button.url)
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:12px 20px;background:${light.brand};color:${light.onBrand};border-radius:${radius};font-weight:600;text-decoration:none">${escapeHtml(content.button.label)}</a></p>`
      : "";

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.heading)}</title></head>` +
    `<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:${font};color:#0f0f0f">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:${radius}"><tr><td style="padding:24px">` +
    `${head}` +
    `<h1 style="margin:24px 0 12px;font-size:20px;line-height:1.3">${escapeHtml(content.heading)}</h1>` +
    content.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escapeHtml(p)}</p>`).join("") +
    `${button}` +
    `<p style="margin:24px 0 0;font-size:13px;color:#6b6b6b">Sent by ${name}.</p>` +
    `</td></tr></table></body></html>`;

  const text = [content.heading, "", ...content.paragraphs, ...(content.button && isWebUrl(content.button.url) ? ["", `${content.button.label}: ${content.button.url}`] : []), "", `Sent by ${brand.name}.`].join("\n");
  return { html, text };
}
