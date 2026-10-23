"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setBlockAction } from "./actions";

/** "Unblock" on the profile of someone you blocked. */
export function UnblockButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        aria-label={`Unblock ${name}`}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await setBlockAction(userId, false);
            if (result.ok) router.refresh();
            else setError(result.message);
          });
        }}
      >
        {pending ? "Unblocking" : "Unblock"}
      </button>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
