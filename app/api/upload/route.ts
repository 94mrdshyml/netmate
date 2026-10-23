import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMember } from "@/auth/session";
import { MAX_BYTES } from "@/storage/images";
import { uploadPicture } from "@/storage/upload";
import { limitUpload, tooManyMessage } from "@/server/rate-limit";

// Pictures go through the Worker (docs/PRD.md section 12): session, rate limit, size, then the
// file's first bytes, and only then R2. The browser gets back a key to attach on Save.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // A form posted from another site must not upload as the signed-in member.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ message: "Not allowed." }, 403);

  const member = await getMember();
  if (!member) return json({ message: "Sign in first." }, 401);

  const { env } = await getCloudflareContext({ async: true });
  const limited = await limitUpload(env.DB, env.AUTH_SECRET, member.userId);
  if (!limited.ok) return json({ message: tooManyMessage(limited.retryAfterSeconds) }, 429);

  // Refuse an obviously huge body before reading it.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES.banner + 64 * 1024) return json({ message: "That picture is too big." }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "Choose a picture first." }, 400);
  }

  const kind = form.get("kind");
  if (kind !== "avatar" && kind !== "banner") return json({ message: "Unknown picture type." }, 400);

  const result = await uploadPicture(env.MEDIA, member.userId, kind, form.get("file"));
  if (!result.ok) return json({ message: result.message }, result.code === "failed" ? 500 : 400);
  return json({ key: result.key });
}
