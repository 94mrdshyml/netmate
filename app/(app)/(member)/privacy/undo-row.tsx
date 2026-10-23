"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ListedPerson } from "@/server/privacy";
import { Avatar } from "../_components/avatar";
import { setBlockAction, setMuteAction } from "./actions";

/** A blocked or muted person with a button to undo it. Once undone the row says so, and nothing jumps around. */
export function UndoRow({ person, kind }: { person: ListedPerson; kind: "block" | "mute" }) {
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = `${person.firstName} ${person.lastName}`;
  const label = kind === "block" ? "Unblock" : "Unmute";

  return (
    <li className="person">
      <Link href={`/${person.username}`} className="person-info">
        <Avatar userId={person.userId} avatarKey={person.avatarKey} size={44} />
        <span className="person-text">
          <strong>{name}</strong>
          <span className="muted">@{person.username}</span>
        </span>
      </Link>
      {undone ? (
        <span className="muted" role="status">
          {kind === "block" ? "Unblocked" : "Unmuted"}
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          aria-label={`${label} ${name}`}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await (kind === "block" ? setBlockAction(person.userId, false) : setMuteAction(person.userId, false));
              if (result.ok) setUndone(true);
              else setError(result.message);
            });
          }}
        >
          {label}
        </button>
      )}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}
