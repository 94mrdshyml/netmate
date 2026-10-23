import Link from "next/link";
import { BrandMark } from "../../_components/brand-mark";
import { Avatar } from "./avatar";
import { ThemeToggle } from "./theme-toggle";

/** The bar on Home: your picture (opens your account and settings), the instance mark, the theme button. */
export function TopBar({
  instanceName,
  logoKey,
  username,
  userId,
  avatarKey,
}: {
  instanceName: string;
  logoKey: string | null;
  username: string;
  userId: string;
  avatarKey: string | null;
}) {
  return (
    <header className="topbar">
      <Link href="/settings" className="icon-btn topbar-avatar" aria-label={`Account, @${username}`}>
        <Avatar userId={userId} avatarKey={avatarKey} size={32} />
      </Link>
      <BrandMark name={instanceName} logoKey={logoKey} />
      <ThemeToggle />
    </header>
  );
}
