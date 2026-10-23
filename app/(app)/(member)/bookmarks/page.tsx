import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { currentTime } from "@/lib/time";
import { listBookmarks } from "@/server/bookmarks";
import { EmptyState } from "../_components/empty-state";
import { PageHeader } from "../_components/page-header";
import { PostCard } from "../_components/post-card";

export const dynamic = "force-dynamic";

export const metadata = { title: "Saved posts" };

export default async function BookmarksPage({ searchParams }: { searchParams: Promise<{ cursor?: string | string[] }> }) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const page = await listBookmarks(getDb(env.DB), member.userId, { cursor: Array.isArray(cursor) ? cursor[0] : cursor });
  const now = currentTime();

  return (
    <main className="column">
      <PageHeader title="Saved posts" back={{ href: "/settings", label: "Back to Settings" }} centered />
      <p className="hint">Only you can see this list. Nobody is told when you save a post, and posts show no count of saves.</p>

      <section aria-label="Saved posts">
        {page.items.map((post) => (
          <PostCard key={post.id} post={post} viewerId={member.userId} now={now} />
        ))}
        {page.items.length === 0 ? (
          <EmptyState icon="bookmark" title="Nothing saved yet." action={{ href: "/", label: "Back to Home" }}>
            Tap the bookmark under a post to keep it here.
          </EmptyState>
        ) : null}
        {page.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/bookmarks?cursor=${page.nextCursor}`}>
            Older saves
          </Link>
        ) : page.items.length > 0 ? (
          <p className="muted end">That is everything you saved.</p>
        ) : null}
      </section>
    </main>
  );
}
