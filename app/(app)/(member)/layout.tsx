import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { countUnreadAlerts } from "@/server/notifications";
import { Suspense } from "react";
import { BottomNav } from "./_components/bottom-nav";
import { NavigationProgress } from "./_components/navigation-progress";

// Every page a signed-in member uses. Signed-out visitors go to sign in; each page and action
// still checks the session itself.
export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const { env } = await getCloudflareContext({ async: true });
  const unread = await countUnreadAlerts(getDb(env.DB), member.userId);

  return (
    <div className="with-nav">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      {children}
      <BottomNav username={member.username} unread={unread} />
    </div>
  );
}
