// The words of each email the app sends (docs/PRD.md section 7). Each builder returns plain
// content for the one shared layout; the instance name comes in as a value, never as text here.
// Interface copy rule: no emoji and no em dashes.

import type { EmailContent } from "@/email/template";

export type Message = { subject: string; content: EmailContent };

/** One line, however the name was typed: a subject cannot carry a line break. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function pendingForAdmin(
  instanceName: string,
  who: { name: string; username: string; invitedByName: string | null },
  reviewUrl: string | null,
): Message {
  const via = who.invitedByName ? ` through ${who.invitedByName}'s invite link` : "";
  return {
    subject: oneLine(`${who.name} is waiting for approval on ${instanceName}`),
    content: {
      heading: "Someone is waiting for approval",
      paragraphs: [
        `${who.name} (@${who.username}) signed up${via} and cannot sign in until you approve them.`,
        "You can approve or reject the request from the admin panel.",
      ],
      ...(reviewUrl ? { button: { label: "Review requests", url: reviewUrl } } : {}),
    },
  };
}

export function inviteByEmail(instanceName: string, inviterName: string, joinUrl: string): Message {
  return {
    subject: oneLine(`${inviterName} invited you to join ${instanceName}`),
    content: {
      heading: "You are invited",
      paragraphs: [`${inviterName} invited you to join ${instanceName}.`, "Open the invitation to see who is already here and to create your account."],
      button: { label: oneLine(`Join ${instanceName}`), url: joinUrl },
    },
  };
}

export function approvedForInvitee(instanceName: string, firstName: string, signInUrl: string | null): Message {
  return {
    subject: oneLine(`You're in: welcome to ${instanceName}`),
    content: {
      heading: "You're in",
      paragraphs: [`Hi ${firstName},`, `Your request to join ${instanceName} was approved. You can sign in now with the email and password you chose.`],
      ...(signInUrl ? { button: { label: "Sign in", url: signInUrl } } : {}),
    },
  };
}

export function rejectedForInvitee(instanceName: string, firstName: string): Message {
  return {
    subject: oneLine(`About your request to join ${instanceName}`),
    content: {
      heading: "Your request was not approved",
      paragraphs: [
        `Hi ${firstName},`,
        `${instanceName} did not approve your request to join, and the account was removed. If you think this is a mistake, ask the person who invited you.`,
      ],
    },
  };
}
