import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { requireStaff } from "@/auth/admin";
import { getDb } from "@/db";
import { listMembers, MEMBER_FILTERS, siteStats, type MemberFilter, type MemberRow } from "@/server/members";
import { EmptyState } from "../../(member)/_components/empty-state";
import { Icon } from "../../(member)/_components/icon";
import { setModeratorAction } from "../actions";
import { MemberSuspension } from "./member-suspension";
import { Card, Initial, PageHeader, Pill, Toolbar } from "../hq-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Members" };

const FILTER_LABEL: Record<MemberFilter, string> = { all: "Everyone", moderators: "Moderators", pending: "Waiting", suspended: "Suspended" };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The words for each count, in the order shown. */
const COUNTS: { key: keyof MemberRow["counts"]; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "replies", label: "Replies" },
  { key: "quotes", label: "Quotes" },
  { key: "reposts", label: "Reposts" },
  { key: "pictures", label: "Pictures" },
  { key: "gifs", label: "GIFs" },
  { key: "links", label: "Link cards" },
  { key: "likesGiven", label: "Likes given" },
  { key: "likesReceived", label: "Likes received" },
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
];

/** The few numbers shown on the row itself; the rest are one tap away under "All numbers". */
const HEADLINE: (keyof MemberRow["counts"])[] = ["posts", "replies", "likesReceived", "followers"];

function href(query: string, show: MemberFilter, after?: string | null) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (show !== "all") params.set("show", show);
  if (after) params.set("after", after);
  const text = params.toString();
  return text ? `/hq/members?${text}` : "/hq/members";
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; show?: string | string[]; after?: string | string[] }> }) {
  const staff = await requireStaff();
  const isAdmin = staff.role === "admin";
  const params = await searchParams;
  const query = (one(params.q) ?? "").trim().slice(0, 50);
  const show = (MEMBER_FILTERS as readonly string[]).includes(one(params.show) ?? "") ? (one(params.show) as MemberFilter) : "all";
  const after = one(params.after);

  const { env } = await getCloudflareContext({ async: true });
  const db = getDb(env.DB);
  const [page, stats] = await Promise.all([listMembers(db, { isAdmin }, { query, filter: show, cursor: after }), siteStats(db)]);

  return (
    <>
      <PageHeader title="Members">
        {isAdmin ? "Everyone who has joined, what they have made, and who moderates." : "Everyone who has joined and what they have made."} Numbers only: nothing here says who
        liked or looked at whom.
      </PageHeader>

      <Card
        id="members-heading"
        icon="users"
        title="Members"
        aside={
          <Pill>
            {stats.members.active} {stats.members.active === 1 ? "member" : "members"}
            {stats.members.pending > 0 ? `, ${stats.members.pending} waiting` : ""}
            {stats.members.moderators > 0 ? `, ${stats.members.moderators} ${stats.members.moderators === 1 ? "moderator" : "moderators"}` : ""}
          </Pill>
        }
      >
        <Toolbar>
        <form className="hq-inline" role="search" action="/hq/members" method="get">
          <div className="field hq-inline-field">
            <label htmlFor="member-search">Search members</label>
            <input id="member-search" className="input" name="q" type="search" defaultValue={query} maxLength={50} placeholder={isAdmin ? "Name, username or email" : "Name or username"} autoComplete="off" />
          </div>
          {show !== "all" ? <input type="hidden" name="show" value={show} /> : null}
          <button type="submit" className="btn btn-primary">
            <Icon name="search" size={18} />
            Search
          </button>
        </form>

        <nav className="hq-filters" aria-label="Show">
          {MEMBER_FILTERS.map((f) => (
            <Link key={f} href={href(query, f)} className="hq-chip" aria-current={show === f ? "true" : undefined}>
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </nav>
        </Toolbar>

        {page.items.length === 0 ? (
          <EmptyState icon="users" title={query || show !== "all" ? "Nobody matches." : "Nobody has joined yet."}>
            {query || show !== "all" ? "Try another name, or show everyone." : "People who join through an invite link show up here."}
          </EmptyState>
        ) : (
          <ul className="hq-list" aria-label="Members">
            {page.items.map((m) => {
              const name = `${m.firstName} ${m.lastName}`;
              return (
                <li key={m.userId} className="hq-item hq-member">
                  <Initial name={name} />
                  <div className="hq-item-text">
                    <strong>{name}</strong> <span className="muted">@{m.username}</span>{" "}
                    {m.role === "admin" ? <Pill icon="shield">Admin</Pill> : null}
                    {m.isModerator ? <Pill icon="shield">Moderator</Pill> : null}
                    {m.status === "pending" ? <Pill tone="attention">Waiting for approval</Pill> : null}
                    {m.status === "suspended" ? <Pill tone="attention" icon="user-x">Suspended</Pill> : null}
                    {m.isPrivate ? <Pill icon="lock">Private</Pill> : null}
                    <div className="hq-meta">
                      {m.email ? `${m.email} · ` : ""}joined {day(m.joinedAt)}
                      {m.invitedBy ? ` · through ${m.invitedBy}'s link` : ""}
                    </div>
                  </div>
                  {/* Staff may suspend an active member, or lift it; never the owner or themselves, and a moderator only for ordinary members. */}
                  {m.role !== "admin" && m.userId !== staff.userId && (m.status === "active" || m.status === "suspended") && (isAdmin || !m.isModerator) ? (
                    <div className="hq-item-actions">
                      <MemberSuspension userId={m.userId} name={name} suspended={m.status === "suspended"} />
                    </div>
                  ) : null}
                  {isAdmin && m.role !== "admin" && m.status === "active" ? (
                    <div className="hq-item-actions">
                      <form action={setModeratorAction}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <input type="hidden" name="wanted" value={m.isModerator ? "0" : "1"} />
                        <button type="submit" className="btn btn-ghost" aria-label={m.isModerator ? `Remove ${name} as a moderator` : `Make ${name} a moderator`}>
                          <Icon name="shield" size={18} />
                          {m.isModerator ? "Remove moderator" : "Make moderator"}
                        </button>
                      </form>
                    </div>
                  ) : null}
                  <dl className="hq-headline" aria-label={`The main numbers for ${name}`}>
                    {COUNTS.filter((c) => HEADLINE.includes(c.key)).map((c) => (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>{m.counts[c.key]}</dd>
                      </div>
                    ))}
                  </dl>
                  <details className="hq-details">
                    <summary>All numbers</summary>
                    <ul className="hq-counts" aria-label={`What ${name} has made`}>
                      {COUNTS.map((c) => (
                        <li key={c.key}>
                          <span className="hq-count-label">{c.label}</span>
                          <strong>{m.counts[c.key]}</strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        {page.nextCursor ? (
          <p className="hq-more">
            <Link href={href(query, show, page.nextCursor)} className="btn btn-ghost">
              Show more members
            </Link>
          </p>
        ) : null}
      </Card>
    </>
  );
}
