import { getCloudflareContext } from "@opennextjs/cloudflare";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getProfile } from "@/server/profiles";
import { PageHeader } from "../_components/page-header";
import { EditProfileForm } from "./edit-profile-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit profile" };

export default async function EditProfilePage() {
  const member = await getMember();
  if (!member) return null;

  const { env } = await getCloudflareContext({ async: true });
  const profile = await getProfile(getDb(env.DB), member.userId, member.username);
  if (!profile) notFound();

  return (
    <main className="column">
      <PageHeader title="Edit profile" back={{ href: "/settings", label: "Back to Settings" }} />
      <EditProfileForm
        username={profile.username}
        userId={profile.userId}
        pictures={{ avatarKey: profile.avatarKey, bannerKey: profile.bannerKey }}
        initial={{
          firstName: profile.firstName,
          lastName: profile.lastName,
          bio: profile.bio,
          location: profile.location ?? "",
          link: profile.link ?? "",
        }}
      />
    </main>
  );
}
