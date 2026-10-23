"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";

const PAUSE_MS = 250;

/**
 * The search field. Results show while you type: after a short pause the page address changes
 * and the server draws the new results. Pressing Enter also works with no script at all, because
 * this is a plain form that asks for `/search`.
 */
export function SearchBox({ q, tab }: { q: string; tab: "posts" | "people" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [value, setValue] = useState(q);

  function go(next: string) {
    clearTimeout(timer.current);
    const params = new URLSearchParams();
    if (next.trim()) params.set("q", next);
    if (tab === "people") params.set("tab", "people");
    router.replace(params.size ? `/search?${params}` : "/search");
  }

  return (
    <form
      className="search-box"
      role="search"
      action="/search"
      onSubmit={(event) => {
        event.preventDefault();
        go(value);
      }}
    >
      <span className="search-icon">
        <Icon name="search" size={18} />
      </span>
      <input
        ref={input}
        className="input"
        type="search"
        name="q"
        value={value}
        placeholder="Search posts and people"
        aria-label="Search posts and people"
        autoComplete="off"
        autoCapitalize="none"
        enterKeyHint="search"
        maxLength={100}
        onChange={(event) => {
          setValue(event.target.value);
          clearTimeout(timer.current);
          const next = event.target.value;
          timer.current = setTimeout(() => go(next), PAUSE_MS);
        }}
      />
      {tab === "people" ? <input type="hidden" name="tab" value="people" /> : null}
      {value ? (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            go("");
            input.current?.focus();
          }}
        >
          <Icon name="x" size={18} />
        </button>
      ) : null}
    </form>
  );
}
