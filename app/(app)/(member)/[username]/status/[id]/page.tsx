import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { currentTime } from "@/lib/time";
import { getPost, listReplies } from "@/server/posts";
import { Composer } from "../../../_components/composer";
import { Icon } from "../../../_components/icon";
import { PostCard } from "../../../_components/post-card";

export const dynamic = "force-dynamic";

export const metadata = { title: "Post" };

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { username, id } = await params;
  const { cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);

  const post = await getPost(db, member.userId, id);
  // A post that is missing, hidden or under a different username is simply not found.
  if (!post || post.author.username !== username.toLowerCase()) notFound();

  const replies = await listReplies(db, member.userId, post.id, { cursor });
  const now = currentTime();

  return (
    <main className="column">
      <Link className="back" href="/" aria-label="Back to Home">
        <Icon name="arrow-left" />
      </Link>
      <PostCard post={post} viewerId={member.userId} now={now} linkToPost={false} />
      <section aria-label="Reply" className="reply-box">
        <Composer parentId={post.id} placeholder="Write your reply" submitLabel="Reply" />
      </section>
      <section aria-label="Replies">
        {replies.items.map((reply) => (
          <PostCard key={reply.id} post={reply} viewerId={member.userId} now={now} />
        ))}
        {replies.items.length === 0 ? <p className="muted">No replies yet.</p> : null}
        {replies.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/${username}/status/${id}?cursor=${replies.nextCursor}`}>
            More replies
          </Link>
        ) : null}
      </section>
    </main>
  );
}
