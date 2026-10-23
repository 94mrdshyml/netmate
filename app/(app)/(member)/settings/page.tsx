import Link from "next/link";
import { getMember } from "@/auth/session";
import { signOutAction } from "../../sign-in/actions";
import { Icon } from "../_components/icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

// Rows are added here as their screens are built (bookmarks, analytics, privacy, account, admin panel).
export default async function SettingsPage() {
  const member = await getMember();
  if (!member) return null;

  return (
    <main className="column">
      <h1>Settings</h1>
      <p className="muted">
        {member.firstName} {member.lastName} (@{member.username})
      </p>

      <ul className="rows" aria-label="Settings">
        <li>
          <Link href="/invite">
            <span>Invite people</span>
            <Icon name="chevron-right" />
          </Link>
        </li>
        <li>
          <Link href="/profile">
            <span>Edit profile</span>
            <Icon name="chevron-right" />
          </Link>
        </li>
      </ul>

      <form action={signOutAction}>
        <button type="submit" className="btn btn-ghost">
          Log out
        </button>
      </form>
    </main>
  );
}
