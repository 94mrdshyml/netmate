import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { listPeople, setFollow } from "@/server/follows";
import { countUnreadAlerts, listAlerts } from "@/server/notifications";
import { createPost, getPost, listByAuthor, listFeed, listReplies, setLike } from "@/server/posts";
import {
  answerFollowRequest,
  getPrivacy,
  listBlocked,
  listFollowRequests,
  listMuted,
  PRIVACY_LIST_MAX,
  setBlock,
  setMute,
  setPrivate,
} from "@/server/privacy";
import { getProfile } from "@/server/profiles";
import { searchPeople, searchPosts, suggestPeople } from "@/server/search";
import { canSeeContentOf } from "@/server/visibility";

const db = () => getDb(env.DB);

let n = 0;
async function member(opts: { first?: string; isPrivate?: boolean; status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `prv${i}@example.com` });
  await db().insert(profiles).values({
    userId: id,
    username: `prv_${i}`,
    firstName: opts.first ?? `Pat${i}`,
    lastName: "Privacy",
    isPrivate: opts.isPrivate ?? false,
    status: opts.status ?? "active",
  });
  return { id, username: `prv_${i}` };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const postBy = async (authorId: string, text = "a post worth reading") => ((await createPost(db(), authorId, text)) as { id: string }).id;
const sees = async (viewerId: string, postId: string) => (await getPost(db(), viewerId, postId)) !== null;
const alerts = async (userId: string) => (await listAlerts(db(), userId)).items;
const follow = (a: { id: string }, b: { id: string }) => setFollow(db(), a.id, b.id, true);

describe("a private account", () => {
  it("shows its posts to itself and its followers, and to nobody else", async () => {
    const owner = await member({ isPrivate: true });
    const friend = await member();
    const stranger = await member();
    const id = await postBy(owner.id);
    await follow(friend, owner); // sends a request, not a follow
    expect(await sees(friend.id, id)).toBe(false);

    await answerFollowRequest(db(), owner.id, friend.id, true);
    expect(await sees(owner.id, id)).toBe(true);
    expect(await sees(friend.id, id)).toBe(true);
    expect(await sees(stranger.id, id)).toBe(false);

    // Every list obeys the same rule.
    expect((await listByAuthor(db(), friend.id, owner.id)).items).toHaveLength(1);
    expect((await listByAuthor(db(), stranger.id, owner.id)).items).toHaveLength(0);
    expect((await listFeed(db(), friend.id, { scope: "following" })).items.map((p) => p.id)).toContain(id);
    expect((await listFeed(db(), stranger.id, { scope: "all" })).items.map((p) => p.id)).not.toContain(id);
    expect((await searchPosts(db(), friend.id, "worth")).items.map((p) => p.id)).toContain(id);
    expect((await searchPosts(db(), stranger.id, "worth")).items.map((p) => p.id)).not.toContain(id);

    // Unfollowing takes the access away again.
    await setFollow(db(), friend.id, owner.id, false);
    expect(await sees(friend.id, id)).toBe(false);
  });

  it("hides replies, and refuses a reply to a post you cannot see", async () => {
    const owner = await member({ isPrivate: true });
    const friend = await member();
    const stranger = await member();
    await follow(friend, owner);
    await answerFollowRequest(db(), owner.id, friend.id, true);
    const id = await postBy(owner.id);
    await createPost(db(), friend.id, "friend's answer", id);

    expect((await listReplies(db(), owner.id, id)).items).toHaveLength(1);
    expect(await createPost(db(), stranger.id, "can I?", id)).toEqual({ ok: false, code: "parent_not_found" });
    expect(await setLike(db(), stranger.id, id, true)).toEqual({ ok: false, code: "not_found" });
  });

  it("keeps existing followers when it turns private, and approves everyone waiting when it turns public", async () => {
    const owner = await member();
    const old = await member();
    const waiting1 = await member();
    const waiting2 = await member();
    await follow(old, owner);
    await setPrivate(db(), owner.id, true);
    const id = await postBy(owner.id);
    expect(await sees(old.id, id)).toBe(true);

    expect(await follow(waiting1, owner)).toEqual({ ok: true, state: "requested" });
    expect(await follow(waiting2, owner)).toEqual({ ok: true, state: "requested" });
    expect(await getPrivacy(db(), owner.id)).toMatchObject({ isPrivate: true, waiting: 2 });
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'follow_request'", owner.id)).toBe(2);

    await setPrivate(db(), owner.id, false);
    expect(await getPrivacy(db(), owner.id)).toMatchObject({ isPrivate: false, waiting: 0 });
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(3);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'follow_request'", owner.id)).toBe(0);
    expect(await sees(waiting1.id, id)).toBe(true);
    // Doing it again changes nothing.
    await setPrivate(db(), owner.id, false);
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(3);
  });

  it("shows only the header on its profile, with no Mates line and no lists", async () => {
    const owner = await member({ isPrivate: true });
    const friend = await member();
    const stranger = await member();
    const mutual = await member({ first: "Mutual" });
    await follow(mutual, owner);
    await answerFollowRequest(db(), owner.id, mutual.id, true);
    await setFollow(db(), stranger.id, mutual.id, true);

    const view = await getProfile(db(), stranger.id, owner.username);
    expect(view).toMatchObject({ isPrivate: true, canSeeContent: false, iFollow: false, requested: false });
    expect(view?.mates).toEqual({ names: [], total: 0 }); // Mutual follows the owner and the stranger follows Mutual
    expect((await listPeople(db(), stranger.id, owner.id, "followers")).items).toEqual([]);
    expect((await listPeople(db(), stranger.id, owner.id, "following")).items).toEqual([]);

    await follow(friend, owner);
    expect(await getProfile(db(), friend.id, owner.username)).toMatchObject({ canSeeContent: false, requested: true });
    await answerFollowRequest(db(), owner.id, friend.id, true);
    expect(await getProfile(db(), friend.id, owner.username)).toMatchObject({ canSeeContent: true, iFollow: true, requested: false });
    expect((await listPeople(db(), friend.id, owner.id, "followers")).items.map((p) => p.userId).sort()).toEqual([mutual.id, friend.id].sort());
    expect(await canSeeContentOf(db(), owner.id, owner.id)).toBe(true);
  });
});

describe("follow requests", () => {
  it("sends one request and one alert however often it is asked, and taking it back removes both", async () => {
    const owner = await member({ isPrivate: true });
    const asker = await member({ first: "Meera" });
    expect(await follow(asker, owner)).toEqual({ ok: true, state: "requested" });
    expect(await follow(asker, owner)).toEqual({ ok: true, state: "requested" });
    expect(await count("select count(*) as n from follow_requests where target_id = ?", owner.id)).toBe(1);
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(0);

    const [alert] = await alerts(owner.id);
    expect(await alerts(owner.id)).toHaveLength(1);
    expect(alert).toMatchObject({ type: "follow_request", unread: true, post: null });
    expect(alert?.actors[0]).toMatchObject({ userId: asker.id, firstName: "Meera" });
    expect(await listFollowRequests(db(), owner.id)).toMatchObject([{ userId: asker.id, firstName: "Meera" }]);

    expect(await setFollow(db(), asker.id, owner.id, false)).toEqual({ ok: true, state: "none" });
    expect(await setFollow(db(), asker.id, owner.id, false)).toEqual({ ok: true, state: "none" });
    expect(await count("select count(*) as n from follow_requests where target_id = ?", owner.id)).toBe(0);
    expect(await alerts(owner.id)).toHaveLength(0);
  });

  it("approving makes a follower and takes the alert away; repeating it changes nothing", async () => {
    const owner = await member({ isPrivate: true });
    const asker = await member();
    await follow(asker, owner);

    expect(await answerFollowRequest(db(), owner.id, asker.id, true)).toEqual({ ok: true });
    expect(await answerFollowRequest(db(), owner.id, asker.id, true)).toEqual({ ok: true });
    expect(await count("select count(*) as n from follows where follower_id = ? and followee_id = ?", asker.id, owner.id)).toBe(1);
    expect(await count("select count(*) as n from follow_requests where target_id = ?", owner.id)).toBe(0);
    expect(await listFollowRequests(db(), owner.id)).toEqual([]);
    expect(await alerts(owner.id)).toHaveLength(0);
    // Already following, so asking again is simply "following".
    expect(await follow(asker, owner)).toEqual({ ok: true, state: "following" });
  });

  it("declining removes the request and the alert, adds no follow, and the person may ask again", async () => {
    const owner = await member({ isPrivate: true });
    const asker = await member();
    await follow(asker, owner);
    expect(await answerFollowRequest(db(), owner.id, asker.id, false)).toEqual({ ok: true });
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(0);
    expect(await alerts(owner.id)).toHaveLength(0);
    expect(await getProfile(db(), asker.id, owner.username)).toMatchObject({ requested: false, iFollow: false });
    expect(await follow(asker, owner)).toEqual({ ok: true, state: "requested" });
  });

  it("cannot be used to force a follow: answering a request nobody made does nothing", async () => {
    const owner = await member({ isPrivate: true });
    const stranger = await member();
    expect(await answerFollowRequest(db(), owner.id, stranger.id, true)).toEqual({ ok: true });
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(0);
    expect(await answerFollowRequest(db(), owner.id, "not an id", true)).toEqual({ ok: false, code: "not_found" });
  });

  it("is answered only by the account asked: someone else's approval does not count", async () => {
    const owner = await member({ isPrivate: true });
    const other = await member({ isPrivate: true });
    const asker = await member();
    await follow(asker, owner);
    await answerFollowRequest(db(), other.id, asker.id, true);
    expect(await count("select count(*) as n from follows where followee_id = ?", owner.id)).toBe(0);
    expect(await listFollowRequests(db(), owner.id)).toHaveLength(1);
  });

  it("is refused for yourself, a stranger id and a person who is not an active member", async () => {
    const a = await member();
    const pending = await member({ status: "pending" });
    expect(await setFollow(db(), a.id, a.id, true)).toEqual({ ok: false, code: "self" });
    expect(await setFollow(db(), a.id, pending.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setFollow(db(), a.id, "usr_doesnotexist0000000000000", true)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("blocking", () => {
  it("hides each person from the other in every list, in both directions", async () => {
    const a = await member();
    const b = await member();
    const bystander = await member();
    const idA = await postBy(a.id, "from person a, marmalade");
    const idB = await postBy(b.id, "from person b, marmalade");

    expect(await setBlock(db(), a.id, b.id, true)).toEqual({ ok: true, blocked: true });
    for (const [viewer, hidden] of [[a.id, idB], [b.id, idA]] as const) {
      expect(await sees(viewer, hidden)).toBe(false);
      expect((await searchPosts(db(), viewer, "marmalade")).items.map((p) => p.id)).not.toContain(hidden);
      expect((await listFeed(db(), viewer, { scope: "all" })).items.map((p) => p.id)).not.toContain(hidden);
    }
    expect(await sees(a.id, idA)).toBe(true);
    expect(await sees(bystander.id, idA)).toBe(true);
    expect(await sees(bystander.id, idB)).toBe(true);
    expect(await getProfile(db(), a.id, b.username)).toMatchObject({ blockedByMe: true, blockedMe: false, canSeeContent: false });
    expect(await getProfile(db(), b.id, a.username)).toMatchObject({ blockedByMe: false, blockedMe: true, canSeeContent: false });
  });

  it("removes follows, requests and alerts both ways, in one step, and unblocking does not bring them back", async () => {
    const a = await member({ isPrivate: true });
    const b = await member();
    const c = await member({ isPrivate: true });
    await follow(b, a); // request
    await answerFollowRequest(db(), a.id, b.id, true);
    await follow(a, b); // a follows b too
    await follow(b, c); // a pending request from b to c
    const id = await postBy(b.id);
    await setLike(db(), a.id, id, true); // an alert for b about a
    expect(await alerts(b.id)).not.toHaveLength(0);

    await setBlock(db(), b.id, a.id, true);
    expect(await count("select count(*) as n from follows where follower_id in (?, ?) and followee_id in (?, ?)", a.id, b.id, a.id, b.id)).toBe(0);
    expect(await alerts(b.id)).toHaveLength(0);
    expect(await alerts(a.id)).toHaveLength(0);
    // A request to someone else is not touched.
    expect(await listFollowRequests(db(), c.id)).toHaveLength(1);

    await setBlock(db(), b.id, a.id, true); // repeating changes nothing
    expect(await listBlocked(db(), b.id)).toHaveLength(1);

    await setBlock(db(), b.id, a.id, false);
    expect(await setBlock(db(), b.id, a.id, false)).toEqual({ ok: true, blocked: false });
    expect(await count("select count(*) as n from follows where follower_id in (?, ?) and followee_id in (?, ?)", a.id, b.id, a.id, b.id)).toBe(0);
    // a is private, so b can see a's posts again only by asking again.
    const idA = await postBy(a.id);
    expect(await sees(b.id, idA)).toBe(false);
    expect(await sees(a.id, id)).toBe(true);
  });

  it("stops a follow or request in either direction, and is not told to the person blocked", async () => {
    const a = await member();
    const b = await member({ isPrivate: true });
    await setBlock(db(), a.id, b.id, true);
    expect(await setFollow(db(), a.id, b.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setFollow(db(), b.id, a.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await alerts(b.id)).toHaveLength(0);
    expect(await alerts(a.id)).toHaveLength(0);
  });

  it("keeps blocked people out of search, suggestions and the followers lists", async () => {
    const me = await member();
    const gone = await member({ first: "Zebulon" });
    const kept = await member({ first: "Zebedee" });
    const fan = await member();
    await follow(fan, gone);
    await follow(fan, me);
    expect((await searchPeople(db(), me.id, "zeb")).map((p) => p.userId).sort()).toEqual([gone.id, kept.id].sort());

    await setBlock(db(), me.id, gone.id, true);
    expect((await searchPeople(db(), me.id, "zeb")).map((p) => p.userId)).toEqual([kept.id]);
    expect((await searchPeople(db(), gone.id, "Pat")).map((p) => p.userId)).not.toContain(me.id);
    expect((await suggestPeople(db(), me.id, 50)).map((p) => p.userId)).not.toContain(gone.id);
    expect((await suggestPeople(db(), gone.id, 50)).map((p) => p.userId)).not.toContain(me.id);
    expect((await listPeople(db(), me.id, fan.id, "following")).items.map((p) => p.userId)).not.toContain(gone.id);
    expect((await listPeople(db(), me.id, gone.id, "followers")).items).toEqual([]);
    expect((await listPeople(db(), gone.id, me.id, "followers")).items).toEqual([]);
  });

  it("lists who you blocked, newest first, capped at 200, and refuses yourself, unknown ids and pending people", async () => {
    const me = await member();
    const first = await member({ first: "First" });
    const second = await member({ first: "Second" });
    const pending = await member({ status: "pending" });
    await setBlock(db(), me.id, first.id, true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await setBlock(db(), me.id, second.id, true);
    expect((await listBlocked(db(), me.id)).map((p) => p.userId)).toEqual([second.id, first.id]);
    expect(await getPrivacy(db(), me.id)).toMatchObject({ blocked: 2 });
    expect(PRIVACY_LIST_MAX).toBe(200);

    expect(await setBlock(db(), me.id, me.id, true)).toEqual({ ok: false, code: "self" });
    expect(await setBlock(db(), me.id, "usr_doesnotexist0000000000000", true)).toEqual({ ok: false, code: "not_found" });
    expect(await setBlock(db(), me.id, pending.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setBlock(db(), me.id, "nope", false)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("muting", () => {
  it("leaves a person out of your home feed but not off their profile, the post page or search", async () => {
    const me = await member();
    const loud = await member();
    const quiet = await member();
    await follow(me, loud);
    await follow(me, quiet);
    const idLoud = await postBy(loud.id, "loud kumquat");
    const idQuiet = await postBy(quiet.id, "quiet kumquat");

    expect(await setMute(db(), me.id, loud.id, true)).toEqual({ ok: true, muted: true });
    expect(await setMute(db(), me.id, loud.id, true)).toEqual({ ok: true, muted: true });
    const ids = async (scope: "all" | "following") => (await listFeed(db(), me.id, { scope })).items.map((p) => p.id);
    expect(await ids("following")).toEqual([idQuiet]);
    expect(await ids("all")).not.toContain(idLoud);
    expect(await sees(me.id, idLoud)).toBe(true);
    expect((await listByAuthor(db(), me.id, loud.id)).items.map((p) => p.id)).toEqual([idLoud]);
    expect((await searchPosts(db(), me.id, "kumquat")).items.map((p) => p.id).sort()).toEqual([idLoud, idQuiet].sort());
    // Only you are affected.
    expect((await listFeed(db(), quiet.id, { scope: "all" })).items.map((p) => p.id)).toContain(idLoud);
    expect(await getProfile(db(), me.id, loud.username)).toMatchObject({ mutedByMe: true, canSeeContent: true, iFollow: true });

    expect((await listMuted(db(), me.id)).map((p) => p.userId)).toEqual([loud.id]);
    expect(await getPrivacy(db(), me.id)).toMatchObject({ muted: 1 });
    await setMute(db(), me.id, loud.id, false);
    await setMute(db(), me.id, loud.id, false);
    expect(await ids("following")).toContain(idLoud);
    expect(await listMuted(db(), me.id)).toEqual([]);
  });

  it("hides their alerts and does not count them, and brings them back on unmute", async () => {
    const me = await member();
    const loud = await member();
    const kind = await member();
    const id = await postBy(me.id);
    await setLike(db(), loud.id, id, true);
    await setLike(db(), kind.id, id, true);
    expect(await countUnreadAlerts(db(), me.id)).toBe(2);

    await setMute(db(), me.id, loud.id, true);
    expect(await countUnreadAlerts(db(), me.id)).toBe(1);
    const [item] = await alerts(me.id);
    expect(item).toMatchObject({ count: 1 });
    expect(item?.actors[0]?.userId).toBe(kind.id);

    await setFollow(db(), loud.id, me.id, true); // a muted person's follow alert is hidden too
    expect(await countUnreadAlerts(db(), me.id)).toBe(1);

    await setMute(db(), me.id, loud.id, false);
    expect(await countUnreadAlerts(db(), me.id)).toBe(3);
  });

  it("refuses yourself, an unknown id and a person who is not an active member", async () => {
    const me = await member();
    const pending = await member({ status: "pending" });
    expect(await setMute(db(), me.id, me.id, true)).toEqual({ ok: false, code: "self" });
    expect(await setMute(db(), me.id, pending.id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setMute(db(), me.id, "usr_doesnotexist0000000000000", true)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("the database", () => {
  it("refuses a block, mute or request on yourself", async () => {
    const a = await member();
    await expect(env.DB.prepare("insert into blocks (blocker_id, blocked_id) values (?, ?)").bind(a.id, a.id).run()).rejects.toThrow();
    await expect(env.DB.prepare("insert into mutes (muter_id, muted_id) values (?, ?)").bind(a.id, a.id).run()).rejects.toThrow();
    await expect(env.DB.prepare("insert into follow_requests (requester_id, target_id) values (?, ?)").bind(a.id, a.id).run()).rejects.toThrow();
  });

  it("keeps one row per pair", async () => {
    const a = await member();
    const b = await member();
    await env.DB.prepare("insert into blocks (blocker_id, blocked_id) values (?, ?)").bind(a.id, b.id).run();
    await expect(env.DB.prepare("insert into blocks (blocker_id, blocked_id) values (?, ?)").bind(a.id, b.id).run()).rejects.toThrow();
    await env.DB.prepare("insert into follow_requests (requester_id, target_id) values (?, ?)").bind(a.id, b.id).run();
    await expect(env.DB.prepare("insert into follow_requests (requester_id, target_id) values (?, ?)").bind(a.id, b.id).run()).rejects.toThrow();
  });

  it("removes every row about a person when their account is deleted", async () => {
    const a = await member();
    const b = await member({ isPrivate: true });
    await follow(a, b);
    await setMute(db(), a.id, b.id, true);
    await setBlock(db(), b.id, a.id, true);
    await db().delete(user).where(eq(user.id, a.id));
    for (const sql of [
      "select count(*) as n from blocks where blocker_id = ?1 or blocked_id = ?1",
      "select count(*) as n from mutes where muter_id = ?1 or muted_id = ?1",
      "select count(*) as n from follow_requests where requester_id = ?1 or target_id = ?1",
    ]) {
      expect(await count(sql, a.id)).toBe(0);
    }
  });
});
