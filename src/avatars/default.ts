// Default avatars (docs/PRD.md section 5): DiceBear, drawn inside the app, so no reader's
// browser contacts anyone. Only styles whose artwork is CC0 or MIT are included.

import { createAvatar } from "@dicebear/core";
import * as glass from "@dicebear/glass";
import * as identicon from "@dicebear/identicon";
import * as initials from "@dicebear/initials";
import * as notionistsNeutral from "@dicebear/notionists-neutral";
import * as pixelArtNeutral from "@dicebear/pixel-art-neutral";
import * as rings from "@dicebear/rings";
import * as shapes from "@dicebear/shapes";
import * as thumbs from "@dicebear/thumbs";
import { DEFAULT_AVATAR_STYLE } from "@/instance/defaults";
import type { AvatarStyle } from "@/instance/options";

type Style = Parameters<typeof createAvatar>[0];

const STYLES: Record<AvatarStyle, Style> = {
  initials: initials as unknown as Style,
  thumbs: thumbs as unknown as Style,
  shapes: shapes as unknown as Style,
  identicon: identicon as unknown as Style,
  rings: rings as unknown as Style,
  glass: glass as unknown as Style,
  "pixel-art-neutral": pixelArtNeutral as unknown as Style,
  "notionists-neutral": notionistsNeutral as unknown as Style,
};

export function isAvatarStyle(value: string): value is AvatarStyle {
  return Object.hasOwn(STYLES, value);
}

// Dark enough for the white letters of the initials style to stay readable.
const INITIALS_COLOURS = ["1d4ed8", "0f766e", "b45309", "be123c", "6d28d9", "4d7c0f", "0e7490", "a21caf", "c2410c", "475569"];

function pick(username: string): string {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return INITIALS_COLOURS[h % INITIALS_COLOURS.length] ?? "1d4ed8";
}

/**
 * The SVG for a member's default picture. The seed is the username, which is unique, so two
 * people never share a picture. The initials style draws the name's letters, so its letters come
 * from the name and only its colour comes from the username (two people called "Sam Lee" still
 * differ). An unknown stored style falls back to the default instead of failing.
 */
export function defaultAvatarSvg(style: string, input: { username: string; name: string }): string {
  const key: AvatarStyle = isAvatarStyle(style) ? style : DEFAULT_AVATAR_STYLE;
  if (key === "initials") return createAvatar(STYLES[key], { seed: input.name, backgroundColor: [pick(input.username)] }).toString();
  return createAvatar(STYLES[key], { seed: input.username }).toString();
}
