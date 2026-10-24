"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../(member)/_components/icon";

type Item = { href: string; label: string; group: string; icon: IconName; keywords: string };

/**
 * Quick jump for the admin panel: press "/" or Ctrl+K (Cmd+K), type a few letters, press Enter to jump to a page.
 * It also offers "Find members matching ..." so a person can be looked up from anywhere. It only filters the list of pages
 * it is given (the ones this person may open); the server still checks the role on every page.
 */
export function HqSearch({ items, canFindMembers }: { items: Item[]; canFindMembers: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const button = useRef<HTMLButtonElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    // A page whose name starts with what was typed comes first, then one that contains it, then one that only has it among its keywords.
    const rank = (i: Item) => {
      const name = i.label.toLowerCase();
      return words.every((w) => name.startsWith(w) || name.includes(` ${w}`)) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2;
    };
    const pages = items
      .filter((i) => words.every((w) => `${i.label} ${i.group} ${i.keywords}`.toLowerCase().includes(w)))
      .map((i, order) => ({ i, order, score: rank(i) }))
      .sort((x, y) => x.score - y.score || x.order - y.order)
      .map((x) => x.i);
    const text = query.trim();
    const members = canFindMembers && text ? [{ href: `/hq/members?q=${encodeURIComponent(text.slice(0, 50))}`, label: `Find members matching "${text.slice(0, 50)}"`, group: "Members", icon: "search" as IconName, keywords: "" }] : [];
    return [...pages, ...members];
  }, [items, query, canFindMembers]);

  const open = () => {
    setQuery("");
    dialog.current?.showModal();
    input.current?.focus();
  };
  const close = () => dialog.current?.close();
  const go = (href: string) => {
    close();
    router.push(href);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    // Marks the button once the keys are listened for, so a test (or a very quick typist) can tell when "/" will work.
    button.current?.setAttribute("data-ready", "true");
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Arrow keys move between the box and the results; Enter on the box takes the first one.
  const onBoxKey = (e: React.KeyboardEvent) => {
    const links = Array.from(dialog.current?.querySelectorAll<HTMLAnchorElement>(".hq-cmd-list a") ?? []);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      links[0]?.focus();
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const links = Array.from(dialog.current?.querySelectorAll<HTMLAnchorElement>(".hq-cmd-list a") ?? []);
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      links[Math.min(at + 1, links.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (at <= 0) input.current?.focus();
      else links[at - 1]?.focus();
    }
  };

  return (
    <>
      <button ref={button} type="button" className="hq-search-button" aria-label="Go to a page or person" onClick={open} aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K">
        <Icon name="search" size={18} />
        <span className="hq-search-text">Go to a page or person</span>
        <kbd className="hq-kbd" aria-hidden="true">
          /
        </kbd>
      </button>
      <dialog ref={dialog} className="hq-cmd" aria-label="Go to a page or person" onClick={(e) => e.target === dialog.current && close()}>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (results[0]) go(results[0].href);
          }}
        >
          <div className="hq-cmd-box">
            <Icon name="search" size={18} />
            <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onBoxKey} placeholder="Go to a page, or find a member" aria-label="Go to a page or person" autoComplete="off" maxLength={50} />
            <button type="button" className="icon-btn" onClick={close} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          <ul className="hq-cmd-list" onKeyDown={onListKey} aria-label="Results">
            {results.length === 0 ? (
              <li className="hq-cmd-empty">Nothing matches. Try another word.</li>
            ) : (
              results.map((r) => (
                <li key={r.href}>
                  <a
                    href={r.href}
                    onClick={(e) => {
                      e.preventDefault();
                      go(r.href);
                    }}
                  >
                    <Icon name={r.icon} size={18} />
                    <span className="hq-cmd-label">{r.label}</span>
                    <span className="hq-cmd-group">{r.group}</span>
                  </a>
                </li>
              ))
            )}
          </ul>
        </form>
      </dialog>
    </>
  );
}
