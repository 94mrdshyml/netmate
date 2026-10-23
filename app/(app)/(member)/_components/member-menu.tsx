import type { Member } from "@/auth/session";
import { AccountMenu } from "./account-menu";

/** The account menu for the signed-in member: one place that turns a member into the menu's props. */
export function MemberMenu({ member }: { member: Member }) {
  return (
    <AccountMenu
      userId={member.userId}
      username={member.username}
      name={`${member.firstName} ${member.lastName}`}
      avatarKey={member.avatarKey}
      isAdmin={member.role === "admin"}
    />
  );
}
