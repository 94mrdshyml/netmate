"use client";

import { useState, useTransition } from "react";
import { Icon } from "../_components/icon";
import { setPrivateAction } from "./actions";

/** The Private account row: an on and off switch. Going public approves everyone who was waiting. */
export function PrivateSwitch({ isPrivate, waiting }: { isPrivate: boolean; waiting: number }) {
  const [on, setOn] = useState(isPrivate);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="srow srow-static">
      <span className="srow-icon">
        <Icon name="lock" size={22} />
      </span>
      <span className="srow-text">
        <span className="srow-title" id="private-title">
          Private account
        </span>
        <span className="srow-sub" id="private-sub">
          {on
            ? "Only people you approve can follow you and see your posts."
            : waiting > 0
              ? "Anyone here can follow you. Turning this on keeps new followers waiting for you."
              : "Anyone here can follow you and see your posts."}
        </span>
        {on && waiting > 0 ? <span className="srow-sub">Turning this off approves the {waiting === 1 ? "1 person" : `${waiting} people`} waiting.</span> : null}
        {note ? (
          <span className="srow-sub" role="status">
            {note}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby="private-title"
        aria-describedby="private-sub"
        disabled={pending}
        onClick={() => {
          const wanted = !on;
          setOn(wanted);
          setNote(null);
          start(async () => {
            const result = await setPrivateAction(wanted);
            if (result.ok) setNote(wanted ? "Your account is private." : "Your account is public.");
            else {
              setOn(!wanted);
              setNote(result.message);
            }
          });
        }}
      >
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </button>
    </div>
  );
}
