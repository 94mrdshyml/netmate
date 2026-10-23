import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listPeople } from "@/server/follows";
import { getProfile } from "@/server/profiles";
import { EmptyState } from "../../_components/empty-state";
import { PageHeader } from "../../_components/page-header";
import { PersonRow } from "../../_components/person-row";

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
  // A blocked pair see nothing of each other, so there is nothing here to show.
  if (!profile || profile.blockedByMe || profile.blockedMe) notFound();

  // A private account's lists are for its followers (listPeople answers empty for anyone else).
  const locked = !profile.canSeeContent;
  const page = await listPeople(db, viewer.userId, profile.userId, list, { cursor });
  const base = `/${profile.username}`;

  return (
    <main className="column">
      <PageHeader
        title={list === "followers" ? "Followers" : "Following"}
        sub={`${profile.firstName} ${profile.lastName} (@${profile.username})`}
        back={{ href: base, label: `Back to ${profile.firstName}'s profile` }}
      />

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
          <PersonRow key={person.userId} person={person} />
        ))}
      </ul>
      {locked ? (
        <EmptyState icon="lock" title="This account is private.">
          Only people they approve can see who follows them.
        </EmptyState>
      ) : page.items.length === 0 ? (
        list === "followers" ? (
          <EmptyState icon="users" title="No followers yet.">
            When people follow, they show up here.
          </EmptyState>
        ) : (
          <EmptyState icon="users" title="Not following anyone yet." action={{ href: "/search", label: "Find people" }} />
        )
      ) : null}
      {page.nextCursor ? (
        <Link className="btn btn-ghost more" href={`${base}/${list}?cursor=${page.nextCursor}`}>
          More
        </Link>
      ) : null}
    </main>
  );
}
