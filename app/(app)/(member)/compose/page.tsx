import { getMember } from "@/auth/session";
import { Avatar } from "../_components/avatar";
import { Composer } from "../_components/composer";
import { PageHeader } from "../_components/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "New post" };

export default async function ComposePage() {
  const member = await getMember();
  if (!member) return null;

  return (
    <main className="column">
      <PageHeader title="New post" back={{ href: "/", label: "Back to Home" }} />
      <Composer autoFocus leading={<Avatar userId={member.userId} avatarKey={member.avatarKey} size={40} />} />
    </main>
  );
}
