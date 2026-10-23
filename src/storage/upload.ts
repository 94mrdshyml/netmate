// Uploading a profile picture and checking it again before it is attached
// (docs/PRD.md section 8.2: "checked again: exists, belongs to that person, allowed image").

import { isId } from "@/lib/ids";
import { MAX_BYTES, SNIFF_BYTES, sniffImage, type ImageType, type ProfilePictureKind } from "@/storage/images";
import { MEDIA_PREFIXES, newMediaKey } from "@/storage/keys";

export type UploadResult =
  | { ok: true; key: string; type: ImageType }
  | { ok: false; code: "no_file" | "too_big" | "bad_type" | "failed"; message: string };

const MESSAGES = {
  no_file: "Choose a picture first.",
  too_big: (kind: ProfilePictureKind) => `That picture is too big. Pictures can be up to ${MAX_BYTES[kind] / (1024 * 1024)} MB.`,
  bad_type: "Use a JPEG, PNG, WebP or GIF picture.",
  failed: "The picture could not be saved. Try again.",
} as const;

/** Checks the file's size and first bytes, then stores it under the person's own prefix. */
export async function uploadPicture(
  bucket: R2Bucket,
  userId: string,
  kind: ProfilePictureKind,
  file: unknown,
): Promise<UploadResult> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "no_file", message: MESSAGES.no_file };
  if (file.size > MAX_BYTES[kind]) return { ok: false, code: "too_big", message: MESSAGES.too_big(kind) };

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const type = sniffImage(head);
  if (!type) return { ok: false, code: "bad_type", message: MESSAGES.bad_type };

  const key = newMediaKey(kind, userId, type);
  try {
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: IMAGE_CONTENT_TYPE[type], cacheControl: "public, max-age=31536000, immutable" },
    });
  } catch {
    return { ok: false, code: "failed", message: MESSAGES.failed };
  }
  return { ok: true, key, type };
}

const IMAGE_CONTENT_TYPE: Record<ImageType, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * True only when `key` is a picture this person uploaded for this purpose that still exists,
 * is within the size limit, and really is an image of the type its name says.
 */
export async function isAttachable(
  bucket: R2Bucket,
  userId: string,
  kind: ProfilePictureKind,
  key: unknown,
): Promise<boolean> {
  if (typeof key !== "string" || !isId("user", userId)) return false;
  const match = new RegExp(`^${MEDIA_PREFIXES[kind]}/(usr_[0-9A-Za-z]{24})/[0-9A-Za-z]{24}\\.(jpg|png|gif|webp)$`).exec(key);
  if (!match || match[1] !== userId) return false;

  const object = await bucket.head(key);
  if (!object || object.size === 0 || object.size > MAX_BYTES[kind]) return false;

  const first = await bucket.get(key, { range: { offset: 0, length: SNIFF_BYTES } });
  if (!first) return false;
  const type = sniffImage(new Uint8Array(await first.arrayBuffer()));
  return type === match[2];
}

/** Removes a replaced picture. A failure here only leaves an unused file behind. */
export async function removePicture(bucket: R2Bucket, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await bucket.delete(key);
  } catch {
    // The picture is already detached from the profile; a later clean-up can remove the file.
  }
}
