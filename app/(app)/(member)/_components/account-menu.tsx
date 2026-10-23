"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "../../sign-in/actions";
import { Avatar } from "./avatar";
import { Icon, type IconName } from "./icon";

type Item = { href: string; label: string; icon: IconName };

/**
 * Your picture in the corner of Home, Search and Alerts. Tapping it opens a sheet with your
 * profile, invites, Settings, the admin panel (admin only) and Log out. It is a native modal
 * <dialog>, so the page behind is inert, focus stays inside, Escape closes it and focus returns
 * to the picture. /hq checks the admin role again on the server every time.
 */
export function AccountMenu({
  userId,
  username,
  name,
  avatarKey,
  isAdmin,
}: {
  userId: string;
  username: string;
  name: string;
  avatarKey: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const hide = () => dialog.current?.close();
  // Moving to another screen closes the sheet.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  const items: Item[] = [
    { href: `/${username}`, label: "Profile", icon: "user" },
    { href: "/invite", label: "Invite people", icon: "user-plus" },
    { href: "/settings", label: "Settings", icon: "settings" },
    ...(isAdmin ? [{ href: "/hq", label: "Admin panel", icon: "shield" as const }] : []),
  ];

  return (
    <>
      <button
        type="button"
        className="icon-btn topbar-avatar"
        aria-label={`Account, @${username}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <Avatar userId={userId} avatarKey={avatarKey} size={32} />
      </button>

      <dialog
        ref={dialog}
        className="menu-sheet"
        aria-label="Account menu"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // A tap on the dimmed page (the dialog's own box) closes it; taps on the content do not.
          if (event.target === event.currentTarget) hide();
        }}
      >
        <header className="menu-head">
          <Link href={`/${username}`} className="menu-who" onClick={hide}>
            <Avatar userId={userId} avatarKey={avatarKey} size={56} />
            <strong>{name}</strong>
            <span className="muted">@{username}</span>
          </Link>
          <button type="button" className="icon-btn menu-close" aria-label="Close menu" onClick={hide}>
            <Icon name="x" size={22} />
          </button>
        </header>

        <nav aria-label="Account">
          <ul className="menu-list">
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="menu-item" onClick={hide}>
                  <Icon name={item.icon} size={24} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <form action={signOutAction} className="menu-foot">
          <button type="submit" className="menu-item">
            <Icon name="log-out" size={24} />
            <span>Log out</span>
          </button>
        </form>
      </dialog>
    </>
  );
}
