/**
 * The instance's mark: a round chip in the brand colour with the first letter of the instance
 * name, then the name. It reads the name from instance settings, so nothing here is hard-coded.
 * An uploaded logo (from /hq) replaces the chip.
 */
export function BrandMark({ name, logoKey = null, size = "md" }: { name: string; logoKey?: string | null; size?: "md" | "lg" }) {
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span className={`brand brand-${size}`}>
      {logoKey ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own stored logo, never resized by a third party
        <img className="brand-logo" src={`/media/${logoKey}`} alt="" />
      ) : (
        <span className="brand-chip" aria-hidden="true">
          {initial}
        </span>
      )}
      <span className="brand-name">{name}</span>
    </span>
  );
}
