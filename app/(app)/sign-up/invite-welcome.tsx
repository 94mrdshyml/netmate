import type { CSSProperties } from "react";
import Link from "next/link";
import { welcomeLine } from "@/lib/welcome-line";
import type { InviteWelcome } from "@/server/invite-welcome";
import { Avatar } from "../(member)/_components/avatar";
import { BrandMark } from "../_components/brand-mark";

/**
 * The first thing a visitor sees on an invite link: the instance, who invited them, a few faces
 * of people already inside, and one button that opens the sign-up form. Names and pictures are
 * read from the database, so nothing here is fixed text.
 */
export function InviteWelcomeScreen({
  settings,
  inviterName,
  welcome,
  joinHref,
}: {
  settings: { name: string; logoKey: string | null };
  inviterName: string;
  welcome: InviteWelcome | null;
  joinHref: string;
}) {
  return (
    <main className="column stack auth welcome">
      <BrandMark name={settings.name} logoKey={settings.logoKey} size="lg" />
      <div>
        <h1>
          {inviterName} invited you to join {settings.name}
        </h1>
      </div>
      {welcome ? (
        <div className="welcome-people">
          <div className="welcome-faces" aria-hidden="true">
            {welcome.faces.map((p, i) => (
              <span key={p.userId} style={{ display: "contents", "--i": i } as CSSProperties}>
                <Avatar userId={p.userId} avatarKey={p.avatarKey} size={48} />
              </span>
            ))}
          </div>
          <p className="muted">{welcomeLine(welcome.names, welcome.others)}</p>
        </div>
      ) : null}
      <Link className="btn btn-primary btn-block" href={joinHref}>
        Join {settings.name}
      </Link>
      <Link href="/sign-in">Already a member? Sign in</Link>
    </main>
  );
}
