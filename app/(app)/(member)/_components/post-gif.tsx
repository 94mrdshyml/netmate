import type { PostGif as Gif } from "@/lib/gif";

/**
 * The GIF on a post. It is loaded by the reader's own phone straight from Klipy, as Klipy's rules
 * require, with no referrer. The saved size reserves the space so the page does not jump.
 */
export function PostGif({ gif }: { gif: Gif }) {
  return (
    <div className="post-gif" style={{ width: `min(100%, ${gif.width}px)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture straight from Klipy, which its rules require */}
      <img
        src={gif.url}
        alt={gif.title ?? "GIF"}
        width={gif.width}
        height={gif.height}
        style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
