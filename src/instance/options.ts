// The choices an admin can pick in /setup and /hq (docs/PRD.md section 5).

/** Open-licence families from Google Fonts. The font file itself is self-hosted later. */
export const FONT_OPTIONS = [
  "Inter",
  "DM Sans",
  "Nunito",
  "Poppins",
  "Space Grotesk",
  "Lora",
  "Merriweather",
  "JetBrains Mono",
] as const;

/** DiceBear styles for default avatars, generated inside the app. Artwork is CC0 or MIT only. */
export const AVATAR_STYLES = [
  "initials",
  "thumbs",
  "shapes",
  "identicon",
  "rings",
  "glass",
  "pixel-art-neutral",
  "notionists-neutral",
] as const;

export const RADIUS_OPTIONS = ["zero", "sm", "md", "lg"] as const;

export type FontOption = (typeof FONT_OPTIONS)[number];
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
