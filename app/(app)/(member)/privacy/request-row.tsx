"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ListedPerson } from "@/server/privacy";
import { Avatar } from "../_components/avatar";
import { answerRequestAction } from "./actions";

/** One person waiting for an answer, with Approve and Decline. After the answer the row says what happened. */
export function RequestRow({ person }: { person: ListedPerson }) {
  const [answer, setAnswer] = useState<"approved" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = `${person.firstName} ${person.lastName}`;

  const send = (approve: boolean) => {
    setError(null);
    start(async () => {
      const result = await answerRequestAction(person.userId, approve);
      if (result.ok) setAnswer(approve ? "approved" : "declined");
      else setError(result.message);
    });
  };

  return (
    <li className="person person-request">
      <Link href={`/${person.username}`} className="person-info">
        <Avatar userId={person.userId} avatarKey={person.avatarKey} size={44} />
        <span className="person-text">
          <strong>{name}</strong>
          <span className="muted">@{person.username}</span>
          {person.bio ? <span className="person-bio">{person.bio}</span> : null}
        </span>
      </Link>
      {answer ? (
        <span className="muted" role="status">
          {answer === "approved" ? "Approved" : "Declined"}
        </span>
      ) : (
        <span className="person-actions">
          <button type="button" className="btn btn-primary" disabled={pending} aria-label={`Approve ${name}`} onClick={() => send(true)}>
            Approve
          </button>
          <button type="button" className="btn btn-ghost" disabled={pending} aria-label={`Decline ${name}`} onClick={() => send(false)}>
            Decline
          </button>
        </span>
      )}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}
