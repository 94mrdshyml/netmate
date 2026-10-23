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

/**
 * The SVG for a member's default picture. The seed is the account id, so the picture survives a
 * name change. The initials style needs the name to draw letters, so it is seeded by the name.
 * An unknown stored style falls back to the default instead of failing.
 */
export function defaultAvatarSvg(style: string, input: { userId: string; name: string }): string {
  const key: AvatarStyle = isAvatarStyle(style) ? style : DEFAULT_AVATAR_STYLE;
  const seed = key === "initials" ? input.name : input.userId;
  return createAvatar(STYLES[key], { seed }).toString();
}
