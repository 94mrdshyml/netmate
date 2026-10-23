import { redirect } from "next/navigation";
import { getInstanceState } from "@/instance/request";

// Every page except /setup lives in this group. A fresh deployment sends everyone to /setup
// until the admin has finished it (docs/PRD.md section 3).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { configured } = await getInstanceState();
  if (!configured) redirect("/setup");
  return children;
}
