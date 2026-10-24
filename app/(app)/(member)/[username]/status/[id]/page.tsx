import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { getInstanceState } from "@/instance/request";
import { currentTime } from "@/lib/time";
import { readKlipyKey } from "@/server/gifs";
import { getPost, listReplies } from "@/server/posts";
import { Composer } from "../../../_components/composer";
import { EmptyState } from "../../../_components/empty-state";
import { PageHeader } from "../../../_components/page-header";
import { Avatar } from "../../../_components/avatar";
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
  const { settings } = await getInstanceState();

  const post = await getPost(db, member.userId, id);
  // A post that is missing, hidden or under a different username is simply not found.
  if (!post || post.author.username !== username.toLowerCase()) notFound();

  const replies = await listReplies(db, member.userId, post.id, { cursor });
  const now = currentTime();
  const gifKey = await readKlipyKey(db, env.SETTINGS_ENCRYPTION_KEY);

  return (
    <main className="column">
      <PageHeader title="Post" back={{ href: "/", label: "Back to Home" }} />
      <PostCard post={post} viewerId={member.userId} now={now} linkToPost={false} />
      <section aria-label="Reply" className="reply-box">
        <Composer
          parentId={post.id}
          placeholder="Write your reply"
          submitLabel="Reply"
          gifKey={gifKey}
          linkPreviews={settings.linkPreviewsEnabled}
          leading={<Avatar userId={member.userId} avatarKey={member.avatarKey} size={40} />}
        />
      </section>
      <section aria-label="Replies">
        {replies.items.map((reply) => (
          <PostCard key={reply.id} post={reply} viewerId={member.userId} now={now} />
        ))}
        {replies.items.length === 0 ? <EmptyState icon="message-circle" title="No replies yet.">Be the first to answer.</EmptyState> : null}
        {replies.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/${username}/status/${id}?cursor=${replies.nextCursor}`}>
            More replies
          </Link>
        ) : null}
      </section>
    </main>
  );
}
