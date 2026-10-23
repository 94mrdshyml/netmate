import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getProfile } from "@/server/profiles";
import { Icon } from "../_components/icon";
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
    <main className="column stack">
      <Link className="back" href="/settings" aria-label="Back to Settings">
        <Icon name="arrow-left" />
      </Link>
      <h1>Edit profile</h1>
      <EditProfileForm
        username={profile.username}
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
