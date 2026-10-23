import Link from "next/link";
import { relativeTime } from "@/lib/time";
import type { QuotedView } from "@/server/posts";
import { Avatar } from "./avatar";

/**
 * The original under a quote post. It is a link to that post. If this reader may not see the original
 * (deleted, from a private account, or blocked) it says so and shows nothing of it. Text only, as text.
 * `plain` draws it without the link, for the composer, where a tap must not leave the draft.
 */
export function QuoteCard({ quote, now, plain = false }: { quote: QuotedView; now: number; plain?: boolean }) {
  if (!quote.available) {
    return (
      <div className="quote-card quote-card-gone">
        <p className="muted">This post isn&apos;t available.</p>
      </div>
    );
  }
  const name = `${quote.author.firstName} ${quote.author.lastName}`;
  const extras = [quote.photoCount > 0 ? (quote.photoCount === 1 ? "1 picture" : `${quote.photoCount} pictures`) : null, quote.hasGif ? "a GIF" : null].filter(Boolean);
  const content = (
    <>
      <span className="quote-head">
        <Avatar userId={quote.author.userId} avatarKey={quote.author.avatarKey} size={20} />
        <strong>{name}</strong>
        <span className="muted">@{quote.author.username}</span>
        <span className="muted" aria-hidden="true">
          ·
        </span>
        <time className="muted" dateTime={new Date(quote.createdAt).toISOString()}>
          {relativeTime(quote.createdAt, now)}
        </time>
      </span>
      {quote.body ? <span className="quote-body">{quote.body}</span> : null}
      {extras.length > 0 ? <span className="quote-extra muted">With {extras.join(" and ")}</span> : null}
    </>
  );
  return plain ? (
    <div className="quote-card" role="group" aria-label={`Quoting a post by ${name}`}>
      {content}
    </div>
  ) : (
    <Link href={`/${quote.author.username}/status/${quote.id}`} className="quote-card" aria-label={`Quoted post by ${name}`}>
      {content}
    </Link>
  );
}
