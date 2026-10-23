// Picture rules shared by uploads and by the checks made before a stored file is attached
// (docs/PRD.md sections 8.2 and 11). The file's own first bytes decide its type, never the
// name or the type the browser claims.

export type ImageType = "jpg" | "png" | "gif" | "webp";

export const IMAGE_MIME: Record<ImageType, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** Bytes needed to tell the types apart. */
export const SNIFF_BYTES = 12;

export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  ) {
    return "png";
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.slice(0, 6));
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "webp";
  }
  return null;
}

/** Largest allowed file for each kind of profile picture. */
export const MAX_BYTES = {
  avatar: 2 * 1024 * 1024,
  banner: 5 * 1024 * 1024,
} as const;

export type ProfilePictureKind = keyof typeof MAX_BYTES;
