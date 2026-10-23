/**
 * The instance's mark: a round chip in the brand colour with the first letter of the instance
 * name, then the name. It reads the name from instance settings, so nothing here is hard-coded.
 * (An uploaded logo replaces the chip once logo upload exists in /hq.)
 */
export function BrandMark({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span className={`brand brand-${size}`}>
      <span className="brand-chip" aria-hidden="true">
        {initial}
      </span>
      <span className="brand-name">{name}</span>
    </span>
  );
}
