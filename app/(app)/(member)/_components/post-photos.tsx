/** The pictures on a post: one wide, or a tidy grid of up to four. Each opens the full picture. */
export function PostPhotos({ keys, name }: { keys: string[]; name: string }) {
  if (keys.length === 0) return null;
  return (
    <ul className={`post-photos n${keys.length}`} aria-label={`Pictures from ${name}`}>
      {keys.map((key, i) => (
        <li key={key}>
          <a href={`/media/${key}`} target="_blank" rel="noopener noreferrer" aria-label={`Open picture ${i + 1} of ${keys.length}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- stored pictures are served by our own /media route */}
            <img src={`/media/${key}`} alt="" loading="lazy" decoding="async" />
          </a>
        </li>
      ))}
    </ul>
  );
}
