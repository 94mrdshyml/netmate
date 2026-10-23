"use client";

import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme-choice";
import { Icon } from "./icon";

/** Applies light or dark at once and remembers it in a cookie, so the server can paint it next time. */
function applyTheme(choice: Exclude<ThemeChoice, "system">) {
  document.documentElement.setAttribute("data-theme", choice);
  try {
    document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Cookies blocked: the choice still applies until the page is closed.
  }
}

/**
 * The sun and moon button in the top bar. Both icons are in the page and the stylesheet shows the
 * right one, so the server and the browser always agree on what to draw.
 */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label="Switch between light and dark"
      onClick={() => {
        const root = document.documentElement;
        const shown = root.getAttribute("data-theme") ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        applyTheme(shown === "dark" ? "light" : "dark");
      }}
    >
      <span className="theme-icon theme-icon-moon">
        <Icon name="moon" size={22} />
      </span>
      <span className="theme-icon theme-icon-sun">
        <Icon name="sun" size={22} />
      </span>
    </button>
  );
}
