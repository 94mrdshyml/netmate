import Link from "next/link";
import type { ReactNode } from "react";
import { parsePostText } from "@/lib/post-entities";
import { findLinks } from "@/lib/post-links";

/**
 * The words of a post, as text. `#tags` and `@mentions` found by parsing become links, but only those
 * the server kept for this post (`tags`, and `mentions` for people who exist); anything else, such as an
 * 11th tag or an unknown name, stays plain. Web addresses become links to that address (in a new tab,
 * with the text exactly as typed). No markup is ever built from the text.
 */
export function PostBody({ text, tags, mentions }: { text: string; tags: string[]; mentions: string[] }) {
  const hasAddress = /https?:\/\/|www\./i.test(text);
  if (!hasAddress && !text.includes("#") && !text.includes("@")) return <>{text}</>;
  const tagSet = new Set(tags);
  const mentionSet = new Set(mentions);
  return (
    <>
      {parsePostText(text).flatMap<ReactNode>((part, i) => {
        if (part.kind === "tag" && tagSet.has(part.tag)) {
          return [
            <Link key={i} href={`/search?q=${encodeURIComponent(`#${part.tag}`)}`} className="entity">
              {part.text}
            </Link>,
          ];
        }
        if (part.kind === "mention" && mentionSet.has(part.username)) {
          return [
            <Link key={i} href={`/${part.username}`} className="entity">
              {part.text}
            </Link>,
          ];
        }
        if (part.kind !== "text" || !hasAddress) return [part.text];
        // Plain text may hold web addresses: link each, keep the words between them.
        const pieces: ReactNode[] = [];
        let from = 0;
        for (const link of findLinks(part.text)) {
          if (link.start > from) pieces.push(part.text.slice(from, link.start));
          pieces.push(
            <a key={`${i}-${link.start}`} href={link.href} className="entity" target="_blank" rel="nofollow noopener noreferrer ugc">
              {link.text}
            </a>,
          );
          from = link.end;
        }
        if (from < part.text.length) pieces.push(part.text.slice(from));
        return pieces;
      })}
    </>
  );
}
