import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { alertAction, snippet, whoPhrase } from "@/lib/alert-text";
import { currentTime, relativeTime } from "@/lib/time";
import { listAlerts, type AlertItem } from "@/server/notifications";
import { Avatar } from "../_components/avatar";
import { Icon, type IconName } from "../_components/icon";
import { AccountLink } from "../_components/account-link";
import { PageHeader } from "../_components/page-header";
import { MarkRead } from "./mark-read";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alerts" };

const ICONS: Record<AlertItem["type"], { icon: IconName; filled?: boolean }> = {
  like: { icon: "heart", filled: true },
  repost: { icon: "heart" },
  follow: { icon: "user-plus" },
  follow_request: { icon: "user-plus" },
  reply: { icon: "message-circle" },
  quote: { icon: "message-circle" },
  mention: { icon: "message-circle" },
  invite_used: { icon: "user-plus" },
  pending_approval: { icon: "user-check" },
};

/** Where tapping the alert goes. A person who is not approved yet has no profile page to open. */
function hrefFor(item: AlertItem): string | null {
  const actor = item.actors[0];
  if (item.type === "pending_approval") return "/hq/approvals";
  if (item.post) return `/${item.post.authorUsername}/status/${item.post.id}`;
  return actor?.active ? `/${actor.username}` : null;
}

function AlertRow({ item, now }: { item: AlertItem; now: number }) {
  const names = item.actors.map((a) => `${a.firstName} ${a.lastName}`);
  const href = hrefFor(item);
  const { icon, filled } = ICONS[item.type];
  const body = (
    <>
      <span className={`alert-icon alert-icon-${item.type}`}>
        <Icon name={icon} size={22} filled={filled} />
      </span>
      <span className="alert-main">
        <span className="alert-avatars">
          {item.actors.map((a) => (
            <Avatar key={a.userId} userId={a.userId} avatarKey={a.avatarKey} size={32} />
          ))}
        </span>
        <span className="alert-text">
          <strong>{whoPhrase(names, item.count)}</strong> {alertAction(item.type)}{" "}
          <time className="muted" dateTime={new Date(item.createdAt).toISOString()}>
            {relativeTime(item.createdAt, now)}
          </time>
        </span>
        {item.post ? <span className="alert-snippet">{snippet(item.post.body)}</span> : null}
      </span>
    </>
  );
  return (
    <li className={item.unread ? "alert alert-unread" : "alert"}>
      {href ? (
        <Link href={href} className="alert-link">
          {body}
          {item.unread ? <span className="sr-only">Unread</span> : null}
        </Link>
      ) : (
        <div className="alert-link">{body}</div>
      )}
    </li>
  );
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ cursor?: string | string[] }> }) {
  const member = await getMember();
  if (!member) return null; // The member layout has already sent signed-out visitors to sign in.

  const { cursor } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const page = await listAlerts(getDb(env.DB), member.userId, { cursor: Array.isArray(cursor) ? cursor[0] : cursor });
  const now = currentTime();

  return (
    <main className="column">
      <PageHeader title="Alerts" lead={<AccountLink member={member} />} />
      <MarkRead hasUnread={page.items.some((item) => item.unread)} />

      {page.items.length > 0 ? (
        <ul className="alerts" aria-label="Alerts">
          {page.items.map((item) => (
            <AlertRow key={item.key} item={item} now={now} />
          ))}
        </ul>
      ) : (
        <p className="empty">No alerts yet. Likes, replies and new followers show up here.</p>
      )}

      {page.nextCursor ? (
        <Link className="btn btn-ghost more" href={`/notifications?cursor=${page.nextCursor}`}>
          Older alerts
        </Link>
      ) : page.items.length > 0 ? (
        <p className="muted end">That is everything.</p>
      ) : null}
    </main>
  );
}
