import Image from "next/image";

/**
 * A member's picture: the uploaded one from /media, or the default drawn by /avatar. Decorative,
 * because the person's name is always next to it. Never optimised or resized by a third party.
 */
export function Avatar({ userId, avatarKey, size = 40 }: { userId: string; avatarKey: string | null; size?: number }) {
  const src = avatarKey ? `/media/${avatarKey}` : `/avatar/${userId}`;
  return <Image className="avatar" src={src} alt="" width={size} height={size} unoptimized />;
}
