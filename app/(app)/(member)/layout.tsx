import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { BottomNav } from "./_components/bottom-nav";

// Every page a signed-in member uses. Signed-out visitors go to sign in; each page and action
// still checks the session itself.
export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  if (!member) redirect("/sign-in");

  return (
    <div className="with-nav">
      {children}
      <BottomNav username={member.username} />
    </div>
  );
}
