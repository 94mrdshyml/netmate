"use client";

import { useState } from "react";
import { Icon } from "../(member)/_components/icon";

export function CopyButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        } catch {
          // Clipboard blocked: nothing to do here, the member can copy it from their own Invite screen.
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={18} />
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
