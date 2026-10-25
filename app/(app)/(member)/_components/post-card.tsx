import Link from "next/link";
import { relativeTime } from "@/lib/time";
import type { PostView } from "@/server/posts";
import { Avatar } from "./avatar";
import { Icon } from "./icon";
import { BookmarkButton, LikeButton, PostMenu, RepostButton } from "./post-actions";
import { LinkCardView } from "./link-card";
import { PostBody } from "./post-body";
import { PostGif } from "./post-gif";
import { PostPhotos } from "./post-photos";
import { QuoteCard } from "./quote-card";
import { SubscribeOffer } from "./subscribe-offer";

/** One post in a list. The text is always rendered as text, never as markup. */
export function PostCard({
  post,
  viewerId,
  now,
  linkToPost = true,
  offer,
}: {
  post: PostView;
  viewerId: string;
  now: number;
  linkToPost?: boolean;
  /** For a locked post: what the Subscribe button offers (null price: the author is not taking new subscribers). `compact` leaves out the long wording because the page already shows it (the Subscribe box on a profile). */
  offer?: { cents: number | null; testMode: boolean; compact?: boolean };
}) {
  const href = `/${post.author.username}/status/${post.id}`;
  const name = `${post.author.firstName} ${post.author.lastName}`;

  return (
    <article className={linkToPost ? "post" : "post post-focus"} aria-label={`Post by ${name}`}>
      {post.repostedBy ? (
        <p className="post-reposted">
          <Icon name="repeat" size={14} />
          <Link href={`/${post.repostedBy.username}`}>
            {post.repostedBy.userId === viewerId ? "You" : `${post.repostedBy.firstName} ${post.repostedBy.lastName}`} reposted
          </Link>
        </p>
      ) : null}
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
          {post.subscribersOnly && !post.locked && !post.parentId ? (
            <span className="post-audience muted">
              <Icon name="lock" size={14} />
              <span>Subscribers only</span>
            </span>
          ) : null}
        </header>
        {post.locked ? (
          <div className="post-locked">
            <p>
              <Icon name="lock" size={16} />
              <strong>This post is for subscribers only.</strong>
            </p>
            {offer && offer.cents !== null ? (
              <SubscribeOffer creatorId={post.author.userId} name={name} offerCents={offer.cents} testMode={offer.testMode} showHint={!offer.compact} />
            ) : (
              <p className="hint">{name} is not taking new subscribers right now.</p>
            )}
          </div>
        ) : null}
        {post.body ? (
          <p className="post-body">
            <PostBody text={post.body} tags={post.tags} mentions={post.mentions} />
          </p>
        ) : null}
        {post.link ? <LinkCardView card={post.link} /> : null}
        <PostPhotos keys={post.photos} name={name} />
        {post.gif ? <PostGif gif={post.gif} /> : null}
        {post.quote ? <QuoteCard quote={post.quote} now={now} /> : null}
        {post.place ? (
          <p className="post-place">
            <Icon name="map-pin" size={14} />
            <span>{post.place}</span>
          </p>
        ) : null}
        {post.locked ? null : (
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
            {post.share !== "none" ? (
              <RepostButton postId={post.id} reposted={post.repostedByMe} count={post.repostCount} share={post.share} />
            ) : null}
            <LikeButton postId={post.id} liked={post.likedByMe} count={post.likeCount} />
            <BookmarkButton postId={post.id} saved={post.bookmarkedByMe} />
            <PostMenu postId={post.id} mine={post.author.userId === viewerId} goHomeAfter={!linkToPost} />
          </footer>
        )}
      </div>
    </article>
  );
}
