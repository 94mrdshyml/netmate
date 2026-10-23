import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { listPeople } from "@/server/follows";
import { getProfile } from "@/server/profiles";
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
  if (!profile) notFound();

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
