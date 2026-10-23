import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { follows, posts, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { listPeople, setFollow } from "@/server/follows";
import { createPost, listByAuthor, listFeed } from "@/server/posts";
import { getProfile, updateProfile } from "@/server/profiles";

const db = () => getDb(env.DB);

let n = 0;
async function member(status: "active" | "pending" = "active", names: [string, string] = ["Fol", "Low"]) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: `${names[0]} ${names[1]}`, email: `fol${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `fol_${i}`, firstName: names[0], lastName: names[1], status });
  return { id, username: `fol_${i}` };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

describe("setFollow", () => {
  it("follows once however many times it is sent, and unfollows the same way", async () => {
    const a = await member();
    const b = await member();

    expect(await setFollow(db(), a.id, b.id, true)).toEqual({ ok: true, following: true });
    expect(await setFollow(db(), a.id, b.id, true)).toEqual({ ok: true, following: true });
    expect(await count("select count(*) as n from follows where follower_id = ? and followee_id = ?", a.id, b.id)).toBe(1);

    expect(await setFollow(db(), a.id, b.id, false)).toEqual({ ok: true, following: false });
    expect(await setFollow(db(), a.id, b.id, false)).toEqual({ ok: true, following: false });
    expect(await count("select count(*) as n from follows where follower_id = ?", a.id)).toBe(0);
  });

  it("refuses to follow yourself, a missing person, a bad id or someone not yet approved", async () => {
    const a = await member();
    const waiting = await member("pending");

    expect(await setFollow(db(), a.id, a.id, true)).toEqual({ ok: false, code: "self" });
    expect(await setFollow(db(), a.id, newId("user"), true)).toEqual({ ok: false, code: "not_found" });
    expect(await setFollow(db(), a.id, "nonsense", true)).toEqual({ ok: false, code: "not_found" });
    expect(await setFollow(db(), a.id, waiting.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await count("select count(*) as n from follows where follower_id = ?", a.id)).toBe(0);
  });

  it("is one row per pair even when the same request arrives many times at once", async () => {
    const a = await member();
    const b = await member();
    await Promise.all(Array.from({ length: 10 }, () => setFollow(db(), a.id, b.id, true)));
    expect(await count("select count(*) as n from follows where follower_id = ? and followee_id = ?", a.id, b.id)).toBe(1);
  });

  it("is refused by the database itself for a self-follow", async () => {
    const a = await member();
    await expect(db().insert(follows).values({ followerId: a.id, followeeId: a.id })).rejects.toThrow();
  });
});

describe("profiles", () => {
  it("shows counts, whether I follow, and joined date", async () => {
    const me = await member();
    const star = await member();
    const fan = await member();
    await setFollow(db(), me.id, star.id, true);
    await setFollow(db(), fan.id, star.id, true);
    await setFollow(db(), star.id, fan.id, true);

    const profile = await getProfile(db(), me.id, star.username);
    expect(profile).toMatchObject({ followerCount: 2, followingCount: 1, iFollow: true, isMe: false, username: star.username });
    expect(profile?.joinedAt).toBeGreaterThan(0);
    expect(await getProfile(db(), fan.id, star.username)).toMatchObject({ iFollow: true });
    expect(await getProfile(db(), star.id, me.username)).toMatchObject({ iFollow: false, followerCount: 0 });
  });

  it("finds a profile whatever the case of the @username, and not an unknown or waiting one", async () => {
    const me = await member();
    const other = await member();
    const waiting = await member("pending");
    expect(await getProfile(db(), me.id, other.username.toUpperCase())).not.toBeNull();
    expect(await getProfile(db(), me.id, "nobody_here")).toBeNull();
    expect(await getProfile(db(), me.id, waiting.username)).toBeNull();
  });

  it("names the people I follow who also follow this person (Mates)", async () => {
    const me = await member();
    const target = await member();
    const a = await member("active", ["Ada", "Lovelace"]);
    const b = await member("active", ["Bob", "Builder"]);
    const stranger = await member();
    for (const m of [a, b]) {
      await setFollow(db(), me.id, m.id, true);
      await setFollow(db(), m.id, target.id, true);
    }
    await setFollow(db(), stranger.id, target.id, true); // follows target, but I do not follow them

    const profile = await getProfile(db(), me.id, target.username);
    expect(profile?.mates.total).toBe(2);
    expect(profile?.mates.names.sort()).toEqual(["Ada Lovelace", "Bob Builder"]);
    expect((await getProfile(db(), me.id, me.username))?.mates).toEqual({ names: [], total: 0 });
  });

  it("lists at most three Mates names but counts them all", async () => {
    const me = await member();
    const target = await member();
    for (let i = 0; i < 5; i++) {
      const m = await member();
      await setFollow(db(), me.id, m.id, true);
      await setFollow(db(), m.id, target.id, true);
    }
    const profile = await getProfile(db(), me.id, target.username);
    expect(profile?.mates.names).toHaveLength(3);
    expect(profile?.mates.total).toBe(5);
  });
});

describe("followers and following lists", () => {
  it("lists newest first with my own follow state, and pages without losing anyone", async () => {
    const star = await member();
    const viewer = await member();
    const fans: string[] = [];
    for (let i = 0; i < 7; i++) {
      const f = await member();
      fans.push(f.id);
      await setFollow(db(), f.id, star.id, true);
    }
    await setFollow(db(), viewer.id, fans[2]!, true);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let first = true;
    do {
      const page = await listPeople(db(), viewer.id, star.id, "followers", { cursor, limit: 3 });
      if (first) expect(page.items).toHaveLength(3);
      first = false;
      seen.push(...page.items.map((p) => p.userId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(fans));
    const all = await listPeople(db(), viewer.id, star.id, "followers");
    expect(all.items.find((p) => p.userId === fans[2])?.iFollow).toBe(true);
    expect(all.items.find((p) => p.userId === fans[3])?.iFollow).toBe(false);
  });

  it("lists who a person follows, marks me, and skips people who are not active", async () => {
    const a = await member();
    const b = await member();
    const waiting = await member("pending");
    await setFollow(db(), a.id, b.id, true);
    await db().insert(follows).values({ followerId: a.id, followeeId: waiting.id });

    const list = await listPeople(db(), b.id, a.id, "following");
    expect(list.items.map((p) => p.userId)).toEqual([b.id]);
    expect(list.items[0]?.isMe).toBe(true);
  });

  it("ignores a forged cursor", async () => {
    const a = await member();
    const b = await member();
    await setFollow(db(), b.id, a.id, true);
    expect((await listPeople(db(), a.id, a.id, "followers", { cursor: "x'; drop table follows;--" })).items).toHaveLength(1);
  });
});

describe("the Following feed", () => {
  it("shows my posts and those of people I follow, not strangers, and no replies", async () => {
    const me = await member();
    const friend = await member();
    const stranger = await member();
    await setFollow(db(), me.id, friend.id, true);

    const mine = await createPost(db(), me.id, "mine");
    const theirs = await createPost(db(), friend.id, "friend post");
    const other = await createPost(db(), stranger.id, "stranger post");
    if (!mine.ok || !theirs.ok || !other.ok) throw new Error("setup failed");
    const reply = await createPost(db(), friend.id, "friend reply", other.id);
    if (!reply.ok) throw new Error("reply failed");

    const ids = (await listFeed(db(), me.id, { scope: "following" })).items.map((p) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(theirs.id);
    expect(ids).not.toContain(other.id);
    expect(ids).not.toContain(reply.id);

    expect((await listFeed(db(), me.id, { scope: "all" })).items.map((p) => p.id)).toContain(other.id);
  });

  it("stops showing someone once I unfollow them", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    const p = await createPost(db(), friend.id, "hello");
    if (!p.ok) throw new Error("setup failed");
    expect((await listFeed(db(), me.id, { scope: "following" })).items.map((x) => x.id)).toContain(p.id);

    await setFollow(db(), me.id, friend.id, false);
    expect((await listFeed(db(), me.id, { scope: "following" })).items.map((x) => x.id)).not.toContain(p.id);
  });
});

describe("a person's own posts and replies", () => {
  it("splits posts from replies and leaves deleted ones out", async () => {
    const a = await member();
    const b = await member();
    const top = await createPost(db(), a.id, "top level");
    const base = await createPost(db(), b.id, "someone else's post");
    if (!top.ok || !base.ok) throw new Error("setup failed");
    const reply = await createPost(db(), a.id, "my reply", base.id);
    if (!reply.ok) throw new Error("reply failed");

    expect((await listByAuthor(db(), b.id, a.id)).items.map((p) => p.id)).toEqual([top.id]);
    expect((await listByAuthor(db(), b.id, a.id, { replies: true })).items.map((p) => p.id)).toEqual([reply.id]);

    await env.DB.prepare("update posts set deleted_at = 1 where id = ?").bind(top.id).run();
    expect((await listByAuthor(db(), b.id, a.id)).items).toHaveLength(0);
  });

  it("shows nothing of a person who is not an active member", async () => {
    const viewer = await member();
    const waiting = await member("pending");
    await db().insert(posts).values({ id: newId("post"), authorId: waiting.id, body: "should not show" });
    expect((await listByAuthor(db(), viewer.id, waiting.id)).items).toHaveLength(0);
  });
});

describe("updateProfile", () => {
  const good = { firstName: "Riya", lastName: "Sen", bio: "hello", location: "Pune", link: "riya.dev" };

  it("saves the fields, normalises the link and keeps the account name in step", async () => {
    const a = await member();
    expect(await updateProfile(db(), a.id, good)).toEqual({ ok: true });

    const profile = await getProfile(db(), a.id, a.username);
    expect(profile).toMatchObject({ firstName: "Riya", lastName: "Sen", bio: "hello", location: "Pune", link: "https://riya.dev/" });
    const account = await env.DB.prepare("select name from user where id = ?").bind(a.id).first<{ name: string }>();
    expect(account?.name).toBe("Riya Sen");
  });

  it("clears the link and location when left empty, and never changes the username", async () => {
    const a = await member();
    await updateProfile(db(), a.id, good);
    await updateProfile(db(), a.id, { ...good, location: "", link: "", username: "hacked_name" });

    const profile = await getProfile(db(), a.id, a.username);
    expect(profile).toMatchObject({ location: null, link: null, username: a.username });
  });

  it("reports every problem at once and changes nothing", async () => {
    const a = await member();
    const res = await updateProfile(db(), a.id, { firstName: "", lastName: "x".repeat(51), bio: "b".repeat(161), location: "l".repeat(61), link: "javascript:alert(1)" });

    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["bio", "firstName", "lastName", "link", "location"]);
    expect((await getProfile(db(), a.id, a.username))?.firstName).toBe("Fol");
  });

  it("refuses control characters in the bio", async () => {
    const a = await member();
    expect(await updateProfile(db(), a.id, { ...good, bio: "hi\u0000there" })).toMatchObject({ ok: false, fieldErrors: { bio: expect.any(String) } });
  });

  it("only ever changes the signed-in person's own profile", async () => {
    const a = await member();
    const b = await member();
    await updateProfile(db(), a.id, { ...good, bio: "a's bio" });
    expect((await getProfile(db(), b.id, b.username))?.bio).toBe("");
  });
});
