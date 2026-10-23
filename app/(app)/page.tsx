import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { currentTime } from "@/lib/time";
import { getInstanceState } from "@/instance/request";
import { ensureInviteLink, inviteUrl } from "@/server/invites";
import { listFeed } from "@/server/posts";
import { Icon } from "./_components/icon";
import { PostCard } from "./_components/post-card";
import { CopyLink } from "./copy-link";
import { signOutAction } from "./sign-in/actions";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const member = await getMember();
  if (!member) redirect("/sign-in");

  const { cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const { settings } = await getInstanceState();
  const feed = await listFeed(db, member.userId, { cursor });
  const now = currentTime();

  // The invite link and sign out live here until Settings exists.
  const invite = await ensureInviteLink(db, member.userId);
  const host = (await headers()).get("host") ?? "localhost";
  const origin = env.BETTER_AUTH_URL ?? `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  return (
    <main className="column">
      <h1>{settings.name}</h1>
      <p className="muted">Signed in as @{member.username}</p>

      <section aria-label="Posts">
        {feed.items.map((post) => (
          <PostCard key={post.id} post={post} viewerId={member.userId} now={now} />
        ))}
        {feed.items.length === 0 ? (
          <p className="empty">Nothing here yet. Be the first to post.</p>
        ) : null}
        {feed.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/?cursor=${feed.nextCursor}`}>
            Older posts
          </Link>
        ) : feed.items.length > 0 ? (
          <p className="muted end">You have seen everything.</p>
        ) : null}
      </section>

      <section aria-label="Invite people" className="stack side-block">
        <h2>Your invite link</h2>
        <p className="hint">
          {member.role === "admin"
            ? "Anyone with this link can join. It never runs out."
            : `The first ${settings.inviteQuota} people who join with this link are approved straight away. Later ones wait for the admin.`}
        </p>
        <CopyLink url={inviteUrl(origin, invite.code)} />
        <form action={signOutAction}>
          <button type="submit" className="btn btn-ghost">
            Sign out
          </button>
        </form>
      </section>

      <Link href="/compose" className="fab" aria-label="New post">
        <Icon name="edit-2" size={24} />
      </Link>
    </main>
  );
}
