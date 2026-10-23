import Link from "next/link";
import { relativeTime } from "@/lib/time";
import type { QuotedView } from "@/server/posts";
import { Avatar } from "./avatar";

/**
 * The original under a quote post. It is a link to that post. If this reader may not see the original
 * (deleted, from a private account, or blocked) it says so and shows nothing of it. The words are text.
 * A small picture or GIF of the original shows in the card: the first picture (with "+2" when there are
 * more), or the GIF. `plain` draws it without the link, for the composer, where a tap must not leave the draft.
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
  const firstPhoto = quote.photos[0];
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
      {firstPhoto ? (
        <span className="quote-media">
          {/* eslint-disable-next-line @next/next/no-img-element -- stored pictures are served by our own /media route */}
          <img src={`/media/${firstPhoto}`} alt={quote.photos.length > 1 ? `Picture 1 of ${quote.photos.length}` : "Picture"} loading="lazy" decoding="async" />
          {quote.photos.length > 1 ? <span className="quote-media-more">+{quote.photos.length - 1}</span> : null}
        </span>
      ) : quote.gif ? (
        <span className="quote-media quote-media-gif">
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture straight from Klipy, which its rules require */}
          <img
            src={quote.gif.url}
            alt={quote.gif.title ?? "GIF"}
            width={quote.gif.width}
            height={quote.gif.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </span>
      ) : null}
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
