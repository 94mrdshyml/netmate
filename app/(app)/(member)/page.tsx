import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { currentTime } from "@/lib/time";
import { listForYou } from "@/server/for-you";
import { listFeed } from "@/server/posts";
import { suggestPeople } from "@/server/search";
import { EmptyState } from "./_components/empty-state";
import { FeedList } from "./_components/feed-list";
import { Icon } from "./_components/icon";
import { NewPostsPill } from "./_components/new-posts-pill";
import { PersonRow } from "./_components/person-row";
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
  // "Mates of your mates": a few people followed by people you follow, after the third post (or under an empty feed).
  const mates = await suggestPeople(db, member.userId, 4, { matesOnly: true });
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

      {/* A new key whenever the page is drawn again (the pill reloads it), so what loaded below and the count start over. */}
      <NewPostsPill key={`pill-${now}`} since={now} />
      {following ? null : <SeenTracker key={`seen-${now}`} />}

      <section aria-label="Posts">
        <FeedList
          key={`${following ? "following" : "for-you"}-${now}`}
          feed={following ? "following" : "for-you"}
          initial={feed.items}
          nextCursor={feed.nextCursor}
          viewerId={member.userId}
          now={now}
          mates={mates}
          endText={following ? "You are all caught up." : "That is everything from the last 7 days."}
        />
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
        {feed.items.length === 0 && mates.length > 0 ? (
          <section className="mates" aria-label="Mates of your mates">
            <h2 className="list-title">Mates of your mates</h2>
            <ul className="people">
              {mates.map((person) => (
                <PersonRow key={person.userId} person={person} />
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      <Link href="/compose" className="fab" aria-label="New post">
        <Icon name="feather" size={24} />
      </Link>
    </main>
  );
}
