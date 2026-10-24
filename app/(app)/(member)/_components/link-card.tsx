"use client";

import { useState, type ReactNode } from "react";
import type { LinkCard as Card } from "@/links/fetch";

/**
 * The card of a web page under a post: its picture (large, on top), the site, the title and a line or two
 * of description. The whole card opens the page in a new tab. It is all plain text and one picture address.
 * The picture is loaded by the reader's own phone from that site, with no referrer (that site sees the
 * reader's address; the admin is told so next to the setting). If the picture fails the card has none.
 * With `plain` it is not a link and shows `children` over its corner: that is the preview in the composer.
 */
export function LinkCardView({ card, plain = false, children }: { card: Card; plain?: boolean; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const inside = (
    <>
      {card.image && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a picture from the linked site, loaded by the reader's phone
        <img className="link-card-image" src={card.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : null}
      <span className="link-card-body">
        <span className="link-card-site">{card.site}</span>
        <span className="link-card-title">{card.title}</span>
        {card.description ? <span className="link-card-desc">{card.description}</span> : null}
      </span>
    </>
  );
  if (plain) {
    return (
      <div className="link-card link-card-plain" role="group" aria-label={`Preview of ${card.site}`}>
        {inside}
        {children}
      </div>
    );
  }
  return (
    <a className="link-card" href={card.url} target="_blank" rel="nofollow noopener noreferrer ugc" aria-label={`${card.title}, from ${card.site}`}>
      {inside}
    </a>
  );
}
