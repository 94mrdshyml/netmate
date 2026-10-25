// The words on an alert (docs/PRD.md section 8.7): who did it, what they did, and a short snippet.
// Pure, so the wording is tested without a database or a page.

import type { NotificationType } from "@/db/app-schema";

export const SNIPPET_MAX = 140;

/** "Meera", "Meera and Sam", "Meera and 2 others". `names` are the people shown, newest first; `total` is how many did it. */
export function whoPhrase(names: string[], total: number): string {
  const first = names[0] ?? "Someone";
  if (total <= 1) return first;
  if (total === 2) return `${first} and ${names[1] ?? "1 other"}`;
  return `${first} and ${total - 1} others`;
}

const ACTION: Record<NotificationType, string> = {
  like: "liked your post",
  repost: "reposted your post",
  follow: "followed you",
  follow_request: "asked to follow you",
  reply: "replied to your post",
  quote: "quoted your post",
  mention: "mentioned you",
  invite_used: "joined with your invite link",
  pending_approval: "is waiting for your approval",
  subscribe: "subscribed to you",
  // These two are from the people who look after the space, and never name them: see `systemAlertText`.
  post_removed: "removed a post of yours",
  report_closed: "looked at your report",
};

/**
 * The two alerts that come from the people who look after the space (docs/PRD.md section 8.8a). They carry no name: the
 * person is told what happened and nothing about who did it, who reported it or why a case was opened. `outcome` is how a
 * case ended ("Handled"), `caseId` its number.
 */
export function systemAlertText(type: "post_removed" | "report_closed", report: { caseId: string; outcome: string } | null): string {
  if (type === "post_removed") return "A post of yours was removed because it broke this space's rules.";
  return report ? `Your report ${report.caseId} was looked at: ${report.outcome}.` : "Your report was looked at.";
}

/** Alerts that say what happened without naming anyone. */
export const SYSTEM_TYPES: ReadonlySet<NotificationType> = new Set(["post_removed", "report_closed"]);

/** What happened, such as "liked your post" ("is waiting" only reads right for one person; only likes and reposts are grouped). */
export const alertAction = (type: NotificationType): string => ACTION[type];

/** The full line, such as "Meera and 2 others liked your post". */
export function alertSentence(type: NotificationType, names: string[], total: number): string {
  return `${whoPhrase(names, total)} ${ACTION[type]}`;
}

/** The post text on one line, cut at 140 characters. */
export function snippet(text: string, max: number = SNIPPET_MAX): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const letters = Array.from(oneLine);
  return letters.length <= max ? oneLine : `${letters.slice(0, max - 3).join("").trimEnd()}...`;
}

/** Alerts of these kinds about the same post collapse into one line within a page. */
export const GROUPED_TYPES: ReadonlySet<NotificationType> = new Set(["like", "repost"]);
