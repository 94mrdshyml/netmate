"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { extractEntities, mentionAtCaret, parsePostText, TAGS_PER_POST } from "@/lib/post-entities";
import { Avatar } from "./avatar";

type Candidate = { userId: string; username: string; firstName: string; lastName: string; avatarKey: string | null };

const SUGGEST_PAUSE_MS = 120;
const CHECK_PAUSE_MS = 450;

/**
 * The text box of the composer. `#tags` and `@names` change colour as they are typed: the words are
 * drawn twice, the real (see-through) text box on top and the same text behind it with the tags and
 * names coloured, so nothing about typing, selecting or the keyboard is different. Typing an `@` opens a
 * list of people to pick from (docs/PRD.md section 8.2). The page the post lands on draws the same
 * parts as links, from what the server kept; this is only the preview of it.
 */
export function ComposeField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows,
  autoFocus,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  rows: number;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [people, setPeople] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);
  // Closed with Escape or after a pick, until the next thing is typed.
  const [dismissed, setDismissed] = useState(false);
  // Which typed names turned out to be real people (true) or nobody (false); names not asked about yet are drawn as real.
  const [known, setKnown] = useState<Record<string, boolean>>({});

  const typing = mentionAtCaret(value, caret);
  const open = typing !== null && !dismissed && people.length > 0;

  // Ask for people after a short pause in typing; only the answer to the newest question is kept.
  const prefix = typing?.prefix;
  useEffect(() => {
    if (prefix === undefined) return;
    const mine = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mentions?q=${encodeURIComponent(prefix)}`, { signal: mine.signal });
        if (!res.ok) return setPeople([]);
        const body = (await res.json().catch(() => ({}))) as { people?: Candidate[] };
        if (mine.signal.aborted) return;
        setPeople(body.people ?? []);
        setActive(0);
      } catch {
        // Suggestions are a convenience. If they are not there, the name can still be typed.
        if (!mine.signal.aborted) setPeople([]);
      }
    }, SUGGEST_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      mine.abort();
    };
  }, [prefix]);

  // Ask once which typed names are real, so a name nobody has stops looking like a link.
  useEffect(() => {
    const wanted = extractEntities(value).mentions.filter((name) => !(name in known));
    if (wanted.length === 0) return;
    const mine = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mentions?names=${encodeURIComponent(wanted.join(","))}`, { signal: mine.signal });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { names?: string[] };
        if (mine.signal.aborted || !Array.isArray(body.names)) return;
        const real = new Set(body.names);
        setKnown((all) => ({ ...all, ...Object.fromEntries(wanted.map((name) => [name, real.has(name)])) }));
      } catch {
        // Not knowing is fine: the name stays coloured, as typed.
      }
    }, CHECK_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      mine.abort();
    };
  }, [value, known]);

  // Follow the cursor wherever it goes (a tap, the arrow keys, a drag), so the list opens for the name under it.
  useEffect(() => {
    const follow = () => {
      if (area.current && document.activeElement === area.current) setCaret(area.current.selectionStart);
    };
    document.addEventListener("selectionchange", follow);
    return () => document.removeEventListener("selectionchange", follow);
  }, []);

  // Keep the coloured copy lined up with the text box when it scrolls.
  const sync = () => {
    if (area.current && backdrop.current) backdrop.current.scrollTop = area.current.scrollTop;
  };
  useLayoutEffect(sync, [value]);

  function pick(person: Candidate) {
    if (!typing) return;
    const next = `${value.slice(0, typing.start)}@${person.username} ${value.slice(caret)}`;
    const position = typing.start + person.username.length + 2;
    setDismissed(true);
    setPeople([]);
    onChange(next);
    // Put the cursor after the name once the new text is in the box.
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  }

  // Only the first ten of each are kept by the server, so only those are coloured.
  const seenTags = new Set<string>();
  const seenNames = new Set<string>();
  const parts = parsePostText(value).map((part, i) => {
    if (part.kind === "tag") {
      const counted = seenTags.has(part.tag) || seenTags.size < TAGS_PER_POST;
      seenTags.add(part.tag);
      return counted ? (
        <span key={i} className="live-entity">
          {part.text}
        </span>
      ) : (
        part.text
      );
    }
    if (part.kind === "mention") {
      const counted = seenNames.has(part.username) || seenNames.size < 10;
      seenNames.add(part.username);
      return counted && known[part.username] !== false ? (
        <span key={i} className="live-entity">
          {part.text}
        </span>
      ) : (
        part.text
      );
    }
    return part.text;
  });

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <div className="composer-field">
        {/* A copy of the text with the tags and names coloured, behind the real box. Not read out: the box is. */}
        <div className="composer-backdrop" ref={backdrop} aria-hidden="true">
          {parts}
          {"​"}
        </div>
        <textarea
          id={id}
          ref={area}
          className="composer-text composer-text-live"
          value={value}
          onChange={(event) => {
            setDismissed(false);
            setCaret(event.target.selectionStart);
            onChange(event.target.value);
          }}
          onScroll={sync}
          onBlur={() => setDismissed(true)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((a) => (a + 1) % people.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((a) => (a <= 0 ? people.length - 1 : a - 1));
            } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.nativeEvent.isComposing) {
              // Enter picks the highlighted person here; it never posts or adds a line while the list is open.
              event.preventDefault();
              const chosen = people[active];
              if (chosen) pick(chosen);
            }
          }}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
        />
      </div>
      {open ? (
        <ul id={listId} className="mention-list" role="listbox" aria-label="People">
          {people.map((person, i) => (
            <li
              key={person.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "mention-option mention-option-active" : "mention-option"}
              // Pointer down, not click, so the pick lands before the box loses focus.
              onPointerDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
            >
              <Avatar userId={person.userId} avatarKey={person.avatarKey} size={32} />
              <span className="mention-names">
                <strong>
                  {person.firstName} {person.lastName}
                </strong>
                <span className="muted">@{person.username}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
