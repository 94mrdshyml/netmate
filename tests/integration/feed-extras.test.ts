import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setFollow } from "@/server/follows";
import { NEW_POSTS_CAP, countNewPosts } from "@/server/feed-news";
import { createPost, deletePost } from "@/server/posts";
import { setBlock, setMute, setPrivate } from "@/server/privacy";
import { suggestPeople } from "@/server/search";

const db = () => getDb(env.DB);
const MIN = 60_000;

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `fx${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `fx_${i}`, firstName: `Fex${i}`, lastName: "Extra" });
  return { id, username: `fx_${i}` };
}
type Person = Awaited<ReturnType<typeof member>>;

async function post(author: Person, text: string, ageMs = 0): Promise<string> {
  const r = await createPost(db(), author.id, text);
  if (!r.ok) throw new Error(r.code);
  if (ageMs > 0) await env.DB.prepare("update posts set created_at = ? where id = ?").bind(Date.now() - ageMs, r.id).run();
  return r.id;
}

describe("new posts from people you follow", () => {
  it("counts the top-level posts of people you follow made after the page was drawn, and nothing else", async () => {
    const me = await member();
    const friend = await member();
    const stranger = await member();
    await setFollow(db(), me.id, friend.id, true);
    const since = Date.now() - MIN;

    await post(friend, "new one");
    await post(friend, "new two");
    await post(friend, "before the page", 5 * MIN);
    await post(stranger, "not followed");
    await post(me, "mine");
    const reply = await post(friend, "first");
    await createPost(db(), friend.id, "a reply", reply);
    const gone = await post(friend, "deleted");
    await deletePost(db(), friend.id, gone);

    // two new, plus "first" (new) = 3; the reply, the deleted post, a stranger's and my own do not count.
    expect(await countNewPosts(db(), me.id, since)).toBe(3);
  });

  it("leaves out people you muted or blocked, and a private account you do not follow", async () => {
    const me = await member();
    const muted = await member();
    const blocked = await member();
    const hidden = await member();
    for (const p of [muted, blocked, hidden]) await setFollow(db(), me.id, p.id, true);
    await post(muted, "m");
    await post(blocked, "b");
    await post(hidden, "h");
    await setMute(db(), me.id, muted.id, true);
    await setBlock(db(), me.id, blocked.id, true);
    await setPrivate(db(), hidden.id, true);
    await setFollow(db(), me.id, hidden.id, false);
    expect(await countNewPosts(db(), me.id, Date.now() - MIN)).toBe(0);
  });

  it("stops counting at one more than the cap, so the pill can say 99+", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    const base = Date.now() - 30_000;
    const values = Array.from({ length: NEW_POSTS_CAP + 5 }, (_, i) => `('${newId("post")}', '${friend.id}', 'bulk ${i}', ${Date.now() - 1000})`).join(",");
    await env.DB.prepare(`insert into posts (id, author_id, body, created_at) values ${values}`).run();
    expect(await countNewPosts(db(), me.id, base)).toBe(NEW_POSTS_CAP + 1);
  });

  it("treats a missing, odd or far-back time as 'now' or seven days, never as everything", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    await post(friend, "recent");
    await post(friend, "older than seven days", 8 * 24 * 60 * MIN);
    expect(await countNewPosts(db(), me.id, undefined)).toBe(0);
    expect(await countNewPosts(db(), me.id, "soon")).toBe(0);
    expect(await countNewPosts(db(), me.id, Number.NaN)).toBe(0);
    expect(await countNewPosts(db(), me.id, 0)).toBe(1);
    expect(await countNewPosts(db(), me.id, Date.now() + 10 * MIN)).toBe(0);
  });
});

describe("Mates of your mates", () => {
  it("suggests people followed by the people you follow, most shared first, and nobody else", async () => {
    const me = await member();
    const f1 = await member();
    const f2 = await member();
    const popular = await member();
    const once = await member();
    const nobody = await member();
    await setFollow(db(), me.id, f1.id, true);
    await setFollow(db(), me.id, f2.id, true);
    await setFollow(db(), f1.id, popular.id, true);
    await setFollow(db(), f2.id, popular.id, true);
    await setFollow(db(), f1.id, once.id, true);

    const got = (await suggestPeople(db(), me.id, 4, { matesOnly: true })).map((p) => p.userId);
    expect(got).toEqual([popular.id, once.id]);
    expect(got).not.toContain(nobody.id);
    // The same list without the option also has the newest members, so the option is what makes it "mates".
    expect((await suggestPeople(db(), me.id, 50)).map((p) => p.userId)).toContain(nobody.id);
  });

  it("never suggests yourself, someone you follow, or anyone blocked either way, and gives at most the limit", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    const already = await member();
    await setFollow(db(), me.id, already.id, true);
    const mine = await member();
    const blocked = await member();
    const blocker = await member();
    for (const p of [already, me, blocked, blocker]) await setFollow(db(), friend.id, p.id, true).catch(() => {});
    await setFollow(db(), friend.id, mine.id, true);
    await setBlock(db(), me.id, blocked.id, true);
    await setBlock(db(), blocker.id, me.id, true);
    const got = (await suggestPeople(db(), me.id, 4, { matesOnly: true })).map((p) => p.userId);
    expect(got).toEqual([mine.id]);

    const crowd: Person[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await member();
      await setFollow(db(), friend.id, c.id, true);
      crowd.push(c);
    }
    expect(await suggestPeople(db(), me.id, 4, { matesOnly: true })).toHaveLength(4);
  });

  it("gives nothing when nobody you follow follows anyone you do not", async () => {
    const me = await member();
    expect(await suggestPeople(db(), me.id, 4, { matesOnly: true })).toEqual([]);
  });
});
