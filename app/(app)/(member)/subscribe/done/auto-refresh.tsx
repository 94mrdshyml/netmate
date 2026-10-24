"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Looks at the page again every two seconds, up to ten times, then stops. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let left = 10;
    const timer = setInterval(() => {
      router.refresh();
      if (--left <= 0) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
