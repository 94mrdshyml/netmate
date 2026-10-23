import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { currentTime } from "@/lib/time";
import { parseTagQuery } from "@/lib/post-entities";
import { buildSearchQuery, SEARCH_MIN_CHARS } from "@/lib/search-query";
import { searchPeople, searchPosts, suggestPeople } from "@/server/search";
import { AccountLink } from "../_components/account-link";
import { EmptyState } from "../_components/empty-state";
import { PersonRow } from "../_components/person-row";
import { PostCard } from "../_components/post-card";
import { SearchBox } from "./search-box";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; tab?: string | string[]; cursor?: string | string[] }>;
}) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const params = await searchParams;
  const q = (one(params.q) ?? "").slice(0, 100);
  // "@meera" is a person, so it opens People unless a tab was asked for.
  const tab = (one(params.tab) ?? (q.trim().startsWith("@") ? "people" : "posts")) === "people" ? "people" : "posts";
  const cursor = one(params.cursor);

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  // "#a" is a real tag even though it is shorter than a word search may be.
  const searchable = buildSearchQuery(q) !== null || parseTagQuery(q) !== null;
  const now = currentTime();

  const tabLink = (to: "posts" | "people") => `/search?${new URLSearchParams({ q, ...(to === "people" ? { tab: "people" } : {}) })}`;

  const header = (
    <header className="page-header searchbar">
      <h1 className="sr-only">Search</h1>
      <AccountLink member={member} />
      <SearchBox q={q} tab={tab} />
    </header>
  );

  // Nothing typed: the people you may know, in place of a separate Explore page.
  if (!q.trim()) {
    const suggestions = await suggestPeople(db, member.userId);
    return (
      <main className="column">
        {header}
        <h2 className="list-title">Suggested for you</h2>
        {suggestions.length > 0 ? (
          <ul className="people" aria-label="Suggested people">
            {suggestions.map((person) => (
              <PersonRow key={person.userId} person={person} />
            ))}
          </ul>
        ) : (
          <EmptyState icon="users" title="No one to suggest yet.">Search for a name or a word.</EmptyState>
        )}
      </main>
    );
  }

  const tabs = (
    <nav className="tabs" aria-label="Search results">
      <Link href={tabLink("posts")} replace aria-current={tab === "posts" ? "page" : undefined}>
        Posts
      </Link>
      <Link href={tabLink("people")} replace aria-current={tab === "people" ? "page" : undefined}>
        People
      </Link>
    </nav>
  );

  if (!searchable) {
    return (
      <main className="column">
        {header}
        {tabs}
        <EmptyState icon="search" title={`Type at least ${SEARCH_MIN_CHARS} letters or numbers.`} />
      </main>
    );
  }

  if (tab === "people") {
    const people = await searchPeople(db, member.userId, q);
    return (
      <main className="column">
        {header}
        {tabs}
        {people.length > 0 ? (
          <ul className="people" aria-label="People">
            {people.map((person) => (
              <PersonRow key={person.userId} person={person} />
            ))}
          </ul>
        ) : (
          <EmptyState icon="users" title={<>No one found for &ldquo;{q.trim()}&rdquo;.</>}>Try another spelling.</EmptyState>
        )}
      </main>
    );
  }

  const results = await searchPosts(db, member.userId, q, { cursor });
  return (
    <main className="column">
      {header}
      {tabs}
      <section aria-label="Posts">
        {results.items.map((post) => (
          <PostCard key={post.id} post={post} viewerId={member.userId} now={now} />
        ))}
        {results.items.length === 0 ? (
          <EmptyState icon="search" title={<>No posts found for &ldquo;{q.trim()}&rdquo;.</>}>
            Try another word.
          </EmptyState>
        ) : null}
        {results.nextCursor ? (
          <Link className="btn btn-ghost more" href={`/search?${new URLSearchParams({ q, cursor: results.nextCursor })}`}>
            More posts
          </Link>
        ) : results.items.length > 0 ? (
          <p className="muted end">That is everything.</p>
        ) : null}
      </section>
    </main>
  );
}
