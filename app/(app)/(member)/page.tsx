import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { currentTime } from "@/lib/time";
import { listForYou } from "@/server/for-you";
import { listFeed } from "@/server/posts";
import { EmptyState } from "./_components/empty-state";
import { Icon } from "./_components/icon";
import { PostCard } from "./_components/post-card";
import { SeenTracker } from "./_components/seen-tracker";
import { TopBar } from "./_components/top-bar";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ cursor?: string; feed?: string }> }) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { cursor, feed: feedParam } = await searchParams;
  const following = feedParam === "following";
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const { settings } = await getInstanceState();
  // Following is newest first; For you is ranked (docs/PRD.md section 8.3).
  const feed = following ? await listFeed(db, member.userId, { cursor, scope: "following" }) : await listForYou(db, member.userId, { cursor });
  const now = currentTime();

  return (
    <main className="column">
      <TopBar instanceName={settings.name} logoKey={settings.logoKey} member={member} />
      <h1 className="sr-only">{settings.name}</h1>

      <nav className="tabs" aria-label="Feeds">
        <Link href="/" aria-current={following ? undefined : "page"}>
          For you
        </Link>
        <Link href="/?feed=following" aria-current={following ? "page" : undefined}>
          Following
        </Link>
      </nav>

      {following ? null : <SeenTracker key={cursor ?? "first"} />}

      <section aria-label="Posts">
        {feed.items.map((post) => (
          <PostCard key={`${post.repostedBy?.userId ?? ""}${post.id}`} post={post} viewerId={member.userId} now={now} />
        ))}
        {feed.items.length === 0 ? (
          following ? (
            <EmptyState icon="users" title="Your feed is empty" action={{ href: "/search", label: "Find people" }}>
              Follow people to see their posts here.
            </EmptyState>
          ) : (
            <EmptyState icon="feather" title="Nothing here yet." action={{ href: "/compose", label: "Write a post" }}>
              Be the first to post.
            </EmptyState>
          )
        ) : null}
        {feed.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/?${following ? "feed=following&" : ""}cursor=${feed.nextCursor}`}>
            {following ? "Older posts" : "More posts"}
          </Link>
        ) : feed.items.length > 0 ? (
          <p className="muted end">{following ? "You are all caught up." : "That is everything from the last 7 days."}</p>
        ) : null}
      </section>

      <Link href="/compose" className="fab" aria-label="New post">
        <Icon name="feather" size={24} />
      </Link>
    </main>
  );
}
