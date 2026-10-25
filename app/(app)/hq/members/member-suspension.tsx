"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REPORT_NOTE_MAX } from "@/lib/report-categories";
import { Icon } from "../../(member)/_components/icon";
import { liftSuspensionAction, suspendMemberAction } from "../actions";

/** Suspend (it asks first, with a note for the other staff) or Lift suspension. Each one sends the state wanted. */
export function MemberSuspension({ userId, name, suspended }: { userId: string; name: string; suspended: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (go: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setError(null);
    start(async () => {
      const result = await go();
      if (result.ok) {
        setAsking(false);
        router.refresh();
      } else setError(result.message);
    });
  };

  if (suspended) {
    return (
      <>
        <button type="button" className="btn btn-ghost" disabled={pending} aria-label={`Lift the suspension of ${name}`} onClick={() => run(() => liftSuspensionAction(userId))}>
          <Icon name="user-check" size={18} />
          Lift suspension
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost" aria-label={`Suspend ${name}`} onClick={() => setAsking(true)}>
        <Icon name="user-x" size={18} />
        Suspend
      </button>
    );
  }

  return (
    <div className="hq-confirm" role="group" aria-label={`Suspend ${name}?`}>
      <p>
        Suspend {name}? They are signed out at once and cannot sign in, and their profile and posts are hidden from everyone until you lift it. They are not emailed.
      </p>
      <div className="field">
        <label htmlFor={`suspend-note-${userId}`}>A note for the other staff (optional)</label>
        <textarea id={`suspend-note-${userId}`} className="textarea" rows={2} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="confirm">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => suspendMemberAction(userId, note))}>
          {pending ? "Suspending" : "Yes, suspend"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setAsking(false)}>
          Keep them
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
