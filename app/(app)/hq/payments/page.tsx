import { redirect } from "next/navigation";
import { requireAdmin } from "@/auth/admin";

export const dynamic = "force-dynamic";

// The old address: Payments became the Polar setup tab of Money. Only the admin gets further; everyone else gets the 404 from the check.
export default async function OldPaymentsPage() {
  await requireAdmin();
  redirect("/hq/money/setup");
}
