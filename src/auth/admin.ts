// The admin check for /hq (CLAUDE.md hard rule 3). Run on the server by every /hq page and action,
// every time. Anyone who is not the signed-in admin gets 404, not 403 or a redirect, so the panel's
// existence is not revealed.

import { notFound } from "next/navigation";
import { getMember, type Member } from "@/auth/session";

export async function requireAdmin(): Promise<Member> {
  const member = await getMember();
  if (!member || member.role !== "admin") notFound();
  return member;
}
