"use client";

import { useState } from "react";
import { Icon, type IconName } from "../(member)/_components/icon";

/** A submit button that asks once more before a step that cannot be undone. */
export function ConfirmButton({ label, confirmLabel, className, icon }: { label: string; confirmLabel: string; className?: string; icon?: IconName }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {icon ? <Icon name={icon} size={18} /> : null}
        {label}
      </button>
    );
  }
  return (
    <span className="hq-confirm" role="group" aria-label={confirmLabel}>
      <button type="submit" className={className}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
