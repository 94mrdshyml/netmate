import type { Member } from "@/auth/session";
import { BrandMark } from "../../_components/brand-mark";
import { AccountLink } from "./account-link";
import { ThemeToggle } from "./theme-toggle";

/** The bar on Home: your picture (opens Settings), the instance mark, the theme button. */
export function TopBar({ instanceName, logoKey, member }: { instanceName: string; logoKey: string | null; member: Member }) {
  return (
    <header className="topbar">
      <AccountLink member={member} />
      <BrandMark name={instanceName} logoKey={logoKey} />
      <ThemeToggle />
    </header>
  );
}
