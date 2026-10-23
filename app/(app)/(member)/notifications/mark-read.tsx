"use client";

import { useEffect } from "react";
import { markAlertsReadAction } from "./actions";

/** Opening the screen marks everything read. It runs in the browser, so a prefetch or a crawler never does it. */
export function MarkRead({ hasUnread }: { hasUnread: boolean }) {
  useEffect(() => {
    if (hasUnread) void markAlertsReadAction();
  }, [hasUnread]);
  return null;
}
