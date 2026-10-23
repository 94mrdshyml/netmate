"use client";

import { useState } from "react";
import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme-choice";
import { Icon } from "./icon";

/** Applies a theme at once and remembers it in a cookie, so the server can paint it next time. */
function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
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

const CHOICES: { value: ThemeChoice; label: string; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "system", label: "Match phone", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** The three-way choice in Settings. */
export function ThemeChoicePicker({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  return (
    <fieldset className="segmented">
      <legend>Appearance</legend>
      <div className="segmented-row">
        {CHOICES.map((c) => (
          <label key={c.value} className="segment">
            <input
              type="radio"
              name="appearance"
              value={c.value}
              checked={choice === c.value}
              onChange={() => {
                setChoice(c.value);
                applyTheme(c.value);
              }}
            />
            <span>
              <Icon name={c.icon} size={18} />
              {c.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
