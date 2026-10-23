import Link from "next/link";
import { parsePostText } from "@/lib/post-entities";

/**
 * The words of a post, as text. `#tags` and `@mentions` found by parsing become links, but only those
 * the server kept for this post (`tags`, and `mentions` for people who exist); anything else, such as an
 * 11th tag or an unknown name, stays plain. No markup is ever built from the text.
 */
export function PostBody({ text, tags, mentions }: { text: string; tags: string[]; mentions: string[] }) {
  if (!text.includes("#") && !text.includes("@")) return <>{text}</>;
  const tagSet = new Set(tags);
  const mentionSet = new Set(mentions);
  return (
    <>
      {parsePostText(text).map((part, i) => {
        if (part.kind === "tag" && tagSet.has(part.tag)) {
          return (
            <Link key={i} href={`/search?q=${encodeURIComponent(`#${part.tag}`)}`} className="entity">
              {part.text}
            </Link>
          );
        }
        if (part.kind === "mention" && mentionSet.has(part.username)) {
          return (
            <Link key={i} href={`/${part.username}`} className="entity">
              {part.text}
            </Link>
          );
        }
        return part.text;
      })}
    </>
  );
}
