import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listPeople } from "@/server/follows";
import { getProfile } from "@/server/profiles";
import { FollowButton } from "../../_components/follow-button";
import { Icon } from "../../_components/icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "People" };

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; list: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const viewer = await getMember();
  if (!viewer) return null;

  const { username, list } = await params;
  if (list !== "followers" && list !== "following") notFound();
  const { cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);

  const profile = await getProfile(db, viewer.userId, username);
  if (!profile) notFound();

  const page = await listPeople(db, viewer.userId, profile.userId, list, { cursor });
  const base = `/${profile.username}`;

  return (
    <main className="column">
      <Link className="back" href={base} aria-label={`Back to ${profile.firstName}'s profile`}>
        <Icon name="arrow-left" />
      </Link>
      <h1>{list === "followers" ? "Followers" : "Following"}</h1>
      <p className="muted">
        {profile.firstName} {profile.lastName} (@{profile.username})
      </p>

      <nav className="tabs" aria-label="People lists">
        <Link href={`${base}/followers`} aria-current={list === "followers" ? "page" : undefined}>
          Followers
        </Link>
        <Link href={`${base}/following`} aria-current={list === "following" ? "page" : undefined}>
          Following
        </Link>
      </nav>

      <ul className="people" aria-label={list === "followers" ? "Followers" : "Following"}>
        {page.items.map((person) => (
          <li key={person.userId} className="person">
            <Link href={`/${person.username}`} className="person-info">
              <strong>
                {person.firstName} {person.lastName}
              </strong>
              <span className="muted">@{person.username}</span>
              {person.bio ? <span className="person-bio">{person.bio}</span> : null}
            </Link>
            {person.isMe ? null : (
              <FollowButton userId={person.userId} name={`${person.firstName} ${person.lastName}`} following={person.iFollow} />
            )}
          </li>
        ))}
      </ul>
      {page.items.length === 0 ? (
        <p className="empty">{list === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : null}
      {page.nextCursor ? (
        <Link className="btn btn-ghost more" href={`${base}/${list}?cursor=${page.nextCursor}`}>
          More
        </Link>
      ) : null}
    </main>
  );
}
