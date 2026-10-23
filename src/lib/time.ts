// Short relative times for posts: "now", "5m", "3h", "2d", then a date (docs/PRD.md section 8.2).

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The current time in milliseconds. Pages call this so the render itself stays free of clock reads. */
export const currentTime = (): number => Date.now();

export function relativeTime(thenMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const then = new Date(thenMs);
  const sameYear = then.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  const base = `${MONTHS[then.getUTCMonth()]} ${then.getUTCDate()}`;
  return sameYear ? base : `${base}, ${then.getUTCFullYear()}`;
}
