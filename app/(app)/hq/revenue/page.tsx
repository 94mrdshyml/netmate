import { redirect } from "next/navigation";
import { requireAdmin } from "@/auth/admin";

export const dynamic = "force-dynamic";

// The old address: Revenue became the Overview tab of Money.
export default async function OldRevenuePage() {
  await requireAdmin();
  redirect("/hq/money");
}
