import Link from "next/link";
import { relativeTime } from "@/lib/time";
import type { PostView } from "@/server/posts";
import { Avatar } from "./avatar";
import { Icon } from "./icon";
import { LikeButton, PostMenu } from "./post-actions";

/** One post in a list. The text is always rendered as text, never as markup. */
export function PostCard({
  post,
  viewerId,
  now,
  linkToPost = true,
}: {
  post: PostView;
  viewerId: string;
  now: number;
  linkToPost?: boolean;
}) {
  const href = `/${post.author.username}/status/${post.id}`;
  const name = `${post.author.firstName} ${post.author.lastName}`;

  return (
    <article className={linkToPost ? "post" : "post post-focus"} aria-label={`Post by ${name}`}>
      <Link href={`/${post.author.username}`} className="post-avatar" tabIndex={-1} aria-hidden="true">
        <Avatar userId={post.author.userId} avatarKey={post.author.avatarKey} size={40} />
      </Link>
      <div className="post-main">
        <header className="post-head">
          <Link href={`/${post.author.username}`} className="author">
            <strong>{name}</strong> <span className="muted">@{post.author.username}</span>
          </Link>
          <span className="muted" aria-hidden="true">
            ·
          </span>
          <time className="muted" dateTime={new Date(post.createdAt).toISOString()}>
            {relativeTime(post.createdAt, now)}
          </time>
        </header>
        <p className="post-body">{post.body}</p>
        <footer className="post-actions">
          {linkToPost ? (
            <Link className="action" href={href} aria-label={`Reply, ${post.replyCount} replies`}>
              <Icon name="message-circle" />
              <span>{post.replyCount}</span>
            </Link>
          ) : (
            <span className="action" aria-label={`${post.replyCount} replies`}>
              <Icon name="message-circle" />
              <span>{post.replyCount}</span>
            </span>
          )}
          <LikeButton postId={post.id} liked={post.likedByMe} count={post.likeCount} />
          {post.author.userId === viewerId ? <PostMenu postId={post.id} goHomeAfter={!linkToPost} /> : null}
        </footer>
      </div>
    </article>
  );
}
