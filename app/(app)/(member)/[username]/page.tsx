import { getCloudflareContext } from "@opennextjs/cloudflare";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { displayLink } from "@/lib/link";
import { currentTime } from "@/lib/time";
import { getProfile } from "@/server/profiles";
import { listByAuthor } from "@/server/posts";
import { Avatar } from "../_components/avatar";
import { EmptyState } from "../_components/empty-state";
import { FollowButton } from "../_components/follow-button";
import { Icon } from "../_components/icon";
import { PageHeader } from "../_components/page-header";
import { PostCard } from "../_components/post-card";
import { ProfileMenu } from "../_components/profile-menu";
import { UnblockButton } from "../privacy/unblock-button";

export const dynamic = "force-dynamic";

const JOINED = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return { title: `@${username.toLowerCase()}` };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string }>;
}) {
  const viewer = await getMember();
  if (!viewer) return null; // The member layout has already sent signed-out visitors to sign in.

  const { username } = await params;
  const { tab, cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);

  const profile = await getProfile(db, viewer.userId, username);
  if (!profile) notFound();
  const name = `${profile.firstName} ${profile.lastName}`;

  // A block, in either direction, hides the person's profile. Nothing else of theirs is shown, and
  // the one who blocked can undo it here.
  if (profile.blockedByMe) {
    return (
      <main className="column">
        <PageHeader title={`@${profile.username}`} back={{ href: "/", label: "Back to Home" }} />
        <EmptyState icon="slash" title={`You blocked @${profile.username}.`}>
          You cannot see each other&apos;s posts. They are not told.
        </EmptyState>
        <div className="blocked-action">
          <UnblockButton userId={profile.userId} name={name} />
        </div>
      </main>
    );
  }
  if (profile.blockedMe) {
    return (
      <main className="column">
        <PageHeader title={`@${profile.username}`} back={{ href: "/", label: "Back to Home" }} />
        <EmptyState icon="slash" title="You cannot see this profile." />
      </main>
    );
  }

  const locked = !profile.canSeeContent;
  const showReplies = tab === "replies";
  const page = locked ? { items: [], nextCursor: null } : await listByAuthor(db, viewer.userId, profile.userId, { replies: showReplies, cursor });
  const now = currentTime();
  const base = `/${profile.username}`;
  const more = profile.mates.total - profile.mates.names.length;
  const followState = profile.iFollow ? "following" : profile.requested ? "requested" : "none";

  return (
    <main className="column">
      <header className="profile-head">
        {profile.bannerKey ? (
          <Image className="banner-img" src={`/media/${profile.bannerKey}`} alt="" width={480} height={160} unoptimized priority />
        ) : (
          <div className="banner-img banner-flat" aria-hidden="true" />
        )}
        <div className="profile-top">
          <div className="profile-avatar">
            <Avatar userId={profile.userId} avatarKey={profile.avatarKey} size={88} />
          </div>
          <div className="profile-action">
            {profile.isMe ? (
              <Link href="/profile" className="btn btn-ghost">
                Edit profile
              </Link>
            ) : (
              <>
                <FollowButton userId={profile.userId} name={name} state={followState} />
                <ProfileMenu userId={profile.userId} name={name} username={profile.username} muted={profile.mutedByMe} />
              </>
            )}
          </div>
        </div>
        <div className="profile-title">
          <h1>{name}</h1>
          <p className="muted">@{profile.username}</p>
        </div>

        {profile.bio ? <p className="bio">{profile.bio}</p> : null}

        <ul className="meta muted">
          {profile.location ? (
            <li>
              <Icon name="map-pin" size={16} />
              <span>{profile.location}</span>
            </li>
          ) : null}
          {profile.link ? (
            <li>
              <Icon name="link" size={16} />
              <a href={profile.link} target="_blank" rel="nofollow noopener noreferrer ugc">
                {displayLink(profile.link)}
              </a>
            </li>
          ) : null}
          <li>
            <Icon name="calendar" size={16} />
            <span>Joined {JOINED.format(profile.joinedAt)}</span>
          </li>
        </ul>

        {/* The lists are for followers of a private account, so the counts are plain numbers there. */}
        <p className="counts">
          {locked ? (
            <>
              <span>
                <strong>{profile.followingCount}</strong> Following
              </span>
              <span>
                <strong>{profile.followerCount}</strong> {profile.followerCount === 1 ? "Follower" : "Followers"}
              </span>
            </>
          ) : (
            <>
              <Link href={`${base}/following`}>
                <strong>{profile.followingCount}</strong> Following
              </Link>
              <Link href={`${base}/followers`}>
                <strong>{profile.followerCount}</strong> {profile.followerCount === 1 ? "Follower" : "Followers"}
              </Link>
            </>
          )}
        </p>

        {profile.mutedByMe ? <p className="muted">You muted this person. Their posts stay out of your Home feed and alerts.</p> : null}

        {profile.mates.total > 0 ? (
          <p className="muted">
            Followed by {profile.mates.names.join(", ")}
            {more > 0 ? ` and ${more} more you follow` : ""}
          </p>
        ) : null}
      </header>

      {locked ? (
        <EmptyState icon="lock" title="This account is private.">
          {profile.requested ? "Your request is waiting for an answer." : "Ask to follow to see their posts and who they follow."}
        </EmptyState>
      ) : null}

      {locked ? null : (
        <>
          <nav className="tabs tabs-top" aria-label="Profile sections">
            <Link href={base} aria-current={showReplies ? undefined : "page"}>
              Posts
            </Link>
            <Link href={`${base}?tab=replies`} aria-current={showReplies ? "page" : undefined}>
              Replies
            </Link>
          </nav>

          <section aria-label={showReplies ? "Replies" : "Posts"}>
            {page.items.map((post) => (
              <PostCard key={`${post.repostedBy?.userId ?? ""}${post.id}`} post={post} viewerId={viewer.userId} now={now} />
            ))}
            {page.items.length === 0 ? (
              showReplies ? (
                <EmptyState icon="message-circle" title="No replies yet." />
              ) : profile.isMe ? (
                <EmptyState icon="feather" title="No posts yet." action={{ href: "/compose", label: "Write a post" }}>
                  Say hello. Your posts show up here.
                </EmptyState>
              ) : (
                <EmptyState icon="feather" title="No posts yet." />
              )
            ) : null}
            {page.nextCursor ? (
              <Link className="btn btn-ghost more" href={`${base}?${showReplies ? "tab=replies&" : ""}cursor=${page.nextCursor}`}>
                Older
              </Link>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
