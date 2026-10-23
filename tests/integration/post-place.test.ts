import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { instance, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setPlacesEnabled } from "@/server/admin";
import { readInstance } from "@/instance/settings";
import { createPost, getPost, listByAuthor, listFeed, listReplies } from "@/server/posts";
import { LIMITS, limitPlaces } from "@/server/rate-limit";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { isPrivate?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `plc${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `plc_${i}`, firstName: `Pat${i}`, lastName: "Place", isPrivate: opts.isPrivate ?? false });
  return { id, username: `plc_${i}` };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postId = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;

describe("a place on a post", () => {
  it("is saved with the post and shown wherever the post is", async () => {
    const author = await member();
    const reader = await member();
    const id = postId(await createPost(db(), author.id, "walking the old town", undefined, [], "Berlin, Germany"));

    expect((await getPost(db(), reader.id, id))?.place).toBe("Berlin, Germany");
    expect((await listFeed(db(), reader.id, { scope: "all" })).items.find((p) => p.id === id)?.place).toBe("Berlin, Germany");
    expect((await listByAuthor(db(), reader.id, author.id)).items[0]?.place).toBe("Berlin, Germany");
    expect((await searchPosts(db(), reader.id, "walking")).items[0]?.place).toBe("Berlin, Germany");
  });

  it("is null when none was given, and an empty or spaces-only place means none", async () => {
    const author = await member();
    for (const place of [undefined, null, "", "   "]) {
      const id = postId(await createPost(db(), author.id, `no place ${String(place)}`, undefined, [], place));
      expect((await getPost(db(), author.id, id))?.place).toBeNull();
    }
  });

  it("is trimmed and squeezed, and kept as plain text", async () => {
    const author = await member();
    const id = postId(await createPost(db(), author.id, "tidy", undefined, [], "  Bengaluru,\n  Karnataka,   India "));
    expect((await getPost(db(), author.id, id))?.place).toBe("Bengaluru, Karnataka, India");
    const marked = postId(await createPost(db(), author.id, "markup", undefined, [], "<b>Oslo</b>"));
    expect((await getPost(db(), author.id, marked))?.place).toBe("<b>Oslo</b>");
  });

  it("allows 60 characters and refuses 61 or odd characters, writing nothing", async () => {
    const author = await member();
    expect(await createPost(db(), author.id, "sixty", undefined, [], "a".repeat(60))).toMatchObject({ ok: true });
    const before = await count("select count(*) as n from posts where author_id = ?", author.id);
    expect(await createPost(db(), author.id, "sixty one", undefined, [], "a".repeat(61))).toEqual({ ok: false, code: "place_too_long" });
    expect(await createPost(db(), author.id, "odd", undefined, [], "Ber\u0000lin")).toEqual({ ok: false, code: "place_bad_characters" });
    expect(await createPost(db(), author.id, "odd", undefined, [], 42)).toEqual({ ok: false, code: "place_bad_characters" });
    expect(await count("select count(*) as n from posts where author_id = ?", author.id)).toBe(before);
  });

  it("does not make a post on its own: words or a picture are still needed", async () => {
    const author = await member();
    expect(await createPost(db(), author.id, "   ", undefined, [], "Berlin, Germany")).toEqual({ ok: false, code: "empty" });
  });

  it("can be on a reply too, and shows there", async () => {
    const author = await member();
    const parent = postId(await createPost(db(), author.id, "a question"));
    const reply = postId(await createPost(db(), author.id, "an answer", parent, [], "Lisbon, Portugal"));
    expect((await listReplies(db(), author.id, parent)).items.find((p) => p.id === reply)?.place).toBe("Lisbon, Portugal");
  });

  it("is hidden with the post: a private account's place is for its followers only", async () => {
    const owner = await member({ isPrivate: true });
    const stranger = await member();
    const id = postId(await createPost(db(), owner.id, "private walk", undefined, [], "Oslo, Norway"));
    expect(await getPost(db(), stranger.id, id)).toBeNull();
    expect((await searchPosts(db(), stranger.id, "private")).items).toEqual([]);
    expect((await listByAuthor(db(), stranger.id, owner.id)).items).toEqual([]);
  });
});

describe("the database check on a place", () => {
  const insert = (place: string | null, author: string) =>
    env.DB.prepare("insert into posts (id, author_id, body, place) values (?, ?, 'x', ?)").bind(newId("post"), author, place).run();

  it("takes no place, one character and sixty characters", async () => {
    const author = await member();
    await insert(null, author.id);
    await insert("a", author.id);
    await insert("a".repeat(60), author.id);
  });

  it("refuses an empty place and a place over sixty characters", async () => {
    const author = await member();
    await expect(insert("", author.id)).rejects.toThrow();
    await expect(insert("a".repeat(61), author.id)).rejects.toThrow();
  });
});

describe("the place suggestion limit", () => {
  const SALT = "test-salt-for-places";
  const T0 = 1_800_000_000_000;

  it("allows 40 lookups a minute per person and then asks to wait, for that person only", async () => {
    expect(LIMITS.places).toMatchObject({ max: 40, windowMs: 60_000 });
    for (let i = 0; i < 40; i++) expect(await limitPlaces(env.DB, SALT, "usr_one", T0 + i)).toEqual({ ok: true });
    expect(await limitPlaces(env.DB, SALT, "usr_one", T0 + 100)).toMatchObject({ ok: false });
    expect(await limitPlaces(env.DB, SALT, "usr_two", T0 + 100)).toEqual({ ok: true });
    // A minute later the first person may look again.
    expect(await limitPlaces(env.DB, SALT, "usr_one", T0 + 61_000)).toEqual({ ok: true });
  });
});

describe("turning place suggestions on and off", () => {
  async function ensureInstance() {
    await db()
      .insert(instance)
      .values({ id: "singleton", name: "Test", primaryColor: "#336699", radius: "md", fontFamily: "Inter", avatarStyle: "initials" })
      .onConflictDoNothing();
  }

  it("follows what the admin chose, and repeating it changes nothing", async () => {
    await ensureInstance();
    expect(await setPlacesEnabled(db(), true)).toEqual({ ok: true, enabled: true });
    expect(await setPlacesEnabled(db(), true)).toEqual({ ok: true, enabled: true });
    expect((await readInstance(db())).settings.placesEnabled).toBe(true);
    expect(await setPlacesEnabled(db(), false)).toEqual({ ok: true, enabled: false });
    expect((await readInstance(db())).settings.placesEnabled).toBe(false);
  });

  it.each([["on"], [1], [0], [null], [undefined], [{}]])("refuses %j and keeps the old choice", async (input) => {
    await ensureInstance();
    await setPlacesEnabled(db(), true);
    expect(await setPlacesEnabled(db(), input)).toMatchObject({ ok: false });
    expect((await readInstance(db())).settings.placesEnabled).toBe(true);
  });
});
