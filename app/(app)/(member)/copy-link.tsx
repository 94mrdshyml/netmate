"use client";

import { useState } from "react";
import { Icon } from "./_components/icon";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="stack">
      <input className="input" readOnly value={url} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            // Clipboard blocked: the link is selectable in the field above.
          }
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={18} />
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
