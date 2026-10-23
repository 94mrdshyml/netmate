import Link from "next/link";
import type { Member } from "@/auth/session";
import { Avatar } from "./avatar";

/**
 * Your picture in the corner of Home, Search and Alerts. It opens Settings, which is where the
 * things about you live (edit profile, invites, theme, log out). Your own profile is the Profile
 * tab in the bottom bar, so it is not repeated here.
 */
export function AccountLink({ member }: { member: Member }) {
  return (
    <Link href="/settings" className="icon-btn topbar-avatar" aria-label={`Settings, signed in as @${member.username}`}>
      <Avatar userId={member.userId} avatarKey={member.avatarKey} size={32} />
    </Link>
  );
}
