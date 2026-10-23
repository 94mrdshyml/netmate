"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PLACE_MAX, checkPlace } from "@/lib/place";
import { Icon } from "./icon";

type Found = { places: { label: string }[]; unavailable?: boolean; message?: string };

const PAUSE_MS = 250;
const MIN_TYPED = 2;

/**
 * The box that opens from the pin in the composer: type a few letters, pick a suggestion, or use
 * what you typed. Suggestions come from our server (which asks OpenStreetMap's Photon), so this
 * phone never contacts anyone else. If suggestions are not available you can still type the place.
 */
export function PlacePicker({ onPick, onClose }: { onPick: (place: string) => void; onClose: () => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => input.current?.focus(), []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Nothing is left running when the box goes away.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  // Ask after a short pause in typing, and keep only the answer to the newest question.
  function ask(value: string) {
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    const typed = value.replace(/\s+/g, " ").trim();
    if (Array.from(typed).length < MIN_TYPED) {
      setFound(null);
      setLoading(false);
      return;
    }
    const mine = new AbortController();
    controller.current = mine;
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(typed)}`, { signal: mine.signal });
        const body = (await res.json().catch(() => ({}))) as Partial<Found>;
        if (mine.signal.aborted) return;
        if (res.ok) setFound({ places: body.places ?? [], unavailable: body.unavailable });
        else setFound({ places: [], message: body.message ?? "Suggestions are not available right now." });
        setActive(-1);
      } catch {
        if (!mine.signal.aborted) setFound({ places: [], unavailable: true });
      } finally {
        if (!mine.signal.aborted) setLoading(false);
      }
    }, PAUSE_MS);
  }

  const typedCheck = checkPlace(text);
  // One letter is too little to suggest from, or to use as a place.
  const typedPlace = typedCheck.ok && typedCheck.place && Array.from(typedCheck.place).length >= MIN_TYPED ? typedCheck.place : null;
  // The suggestions, then (when something valid is typed and is not already a suggestion) "use what I typed".
  const options = [
    ...(found?.places ?? []).map((p) => ({ key: p.label, label: p.label, typed: false })),
    ...(typedPlace && !(found?.places ?? []).some((p) => p.label.toLowerCase() === typedPlace.toLowerCase())
      ? [{ key: "typed", label: typedPlace, typed: true }]
      : []),
  ];

  const note = loading
    ? "Searching"
    : found?.message
      ? found.message
      : found?.unavailable
        ? "Suggestions are not available right now. You can type the place yourself."
        : found && found.places.length === 0 && typedPlace
          ? "No suggestions. You can use what you typed."
          : typedCheck.ok
            ? null
            : typedCheck.reason === "too_long"
              ? `Use ${PLACE_MAX} characters or fewer.`
              : "That has characters we cannot use.";

  return (
    <div className="place-picker">
      <label htmlFor={`${id}-input`} className="place-label">
        Where was this?
      </label>
      <div className="place-field">
        <Icon name="map-pin" size={18} />
        <input
          id={`${id}-input`}
          ref={input}
          className="place-input"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="City or country"
          maxLength={PLACE_MAX + 20}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            ask(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              if (options.length > 0) setActive((a) => (a + 1) % options.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (options.length > 0) setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
            } else if (event.key === "Enter") {
              // Enter must not post the form; it chooses the highlighted place, or what was typed.
              event.preventDefault();
              const chosen = active >= 0 ? options[active]?.label : typedPlace;
              if (chosen) onPick(chosen);
            }
          }}
        />
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {note ? (
        <p className="hint place-note" role="status">
          {note}
        </p>
      ) : null}
      {options.length > 0 ? (
        <ul id={`${id}-list`} className="place-options" role="listbox" aria-label="Places">
          {options.map((option, i) => (
            <li
              key={option.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "place-option place-option-active" : "place-option"}
              // Pointer down, not click, so the choice lands before the box loses focus.
              onPointerDown={(event) => {
                event.preventDefault();
                onPick(option.label);
              }}
            >
              <Icon name="map-pin" size={16} />
              <span>{option.typed ? `Use "${option.label}"` : option.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
