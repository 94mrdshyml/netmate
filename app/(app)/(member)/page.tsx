import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { currentTime } from "@/lib/time";
import { listFeed } from "@/server/posts";
import { Icon } from "./_components/icon";
import { PostCard } from "./_components/post-card";
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
  const feed = await listFeed(db, member.userId, { cursor, scope: following ? "following" : "all" });
  const now = currentTime();

  return (
    <main className="column">
      <TopBar instanceName={settings.name} logoKey={settings.logoKey} username={member.username} userId={member.userId} avatarKey={member.avatarKey} />
      <h1 className="sr-only">{settings.name}</h1>

      {/* "For you" is the latest posts from everyone until the ranked feed arrives. */}
      <nav className="tabs" aria-label="Feeds">
        <Link href="/" aria-current={following ? undefined : "page"}>
          For you
        </Link>
        <Link href="/?feed=following" aria-current={following ? "page" : undefined}>
          Following
        </Link>
      </nav>

      <section aria-label="Posts">
        {feed.items.map((post) => (
          <PostCard key={post.id} post={post} viewerId={member.userId} now={now} />
        ))}
        {feed.items.length === 0 ? (
          <p className="empty">
            {following ? "Your feed is empty. Follow people to see their posts here." : "Nothing here yet. Be the first to post."}
          </p>
        ) : null}
        {feed.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/?${following ? "feed=following&" : ""}cursor=${feed.nextCursor}`}>
            Older posts
          </Link>
        ) : feed.items.length > 0 ? (
          <p className="muted end">{following ? "You are all caught up." : "You have seen everything."}</p>
        ) : null}
      </section>

      <Link href="/compose" className="fab" aria-label="New post">
        <Icon name="feather" size={24} />
      </Link>
    </main>
  );
}
