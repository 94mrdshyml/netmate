// Defaults of a fresh instance (docs/PRD.md section 5). The instance owner changes
// all of these in /setup and /hq; nothing else in the app may hard-code them.

import type { ThemeSettings } from "@/instance/theme";

export const DEFAULT_INSTANCE_NAME = "Netmate";
export const DEFAULT_AVATAR_STYLE = "initials";
export const DEFAULT_INVITE_QUOTA = 5;

export const DEFAULT_THEME: ThemeSettings = {
  primary: "#2F6FED",
  radius: "md",
  fontFamily: "Inter",
};
