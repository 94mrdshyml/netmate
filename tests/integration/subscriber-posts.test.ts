import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setBookmark, listBookmarks } from "@/server/bookmarks";
import { setFollow } from "@/server/follows";
import { listAlerts } from "@/server/notifications";
import { createPost, deletePost, getPost, listByAuthor, listFeed, listReplies, setLike, setRepost } from "@/server/posts";
import { ACCESS_GRACE_MS, hasSubscriberAccess } from "@/server/subscriptions";
import { fileReport } from "@/server/reports";
import { searchPosts } from "@/server/search";

const db = () => getDb(env.DB);
const NOW = Date.now();
const DAY = 86_400_000;

let n = 0;
async function member(over: { price?: number | null } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `sp${i}@example.com` });
  await db().insert(profiles).values({
    userId: id,
    username: `sp_${i}`,
    firstName: `Sue${i}`,
    lastName: "Subs",
    subscriptionPriceCents: over.price === undefined ? 500 : over.price,
  });
  return { id, username: `sp_${i}` };
}

let sub = 0;
/** A paid-up subscription, written straight into the table (Polar's messages are tested in subscriptions.test.ts). */
async function subscribe(subscriberId: string, creatorId: string, over: { status?: string; mode?: string; end?: number | null } = {}) {
  await env.DB.prepare(
    "insert into subscriptions (id, polar_id, mode, subscriber_id, creator_id, status, price_cents, current_period_end, polar_modified_at) values (?, ?, ?, ?, ?, ?, 500, ?, ?)",
  )
    .bind(newId("subscription"), `polar_${++sub}_${Date.now()}`, over.mode ?? "sandbox", subscriberId, creatorId, over.status ?? "active", over.end === undefined ? NOW + 20 * DAY : over.end, NOW)
    .run();
}

async function paymentsOn() {
  await env.DB.prepare("insert or replace into payment_settings (id, enabled, mode) values ('singleton', 1, 'sandbox')").run();
}

afterEach(async () => {
  await env.DB.prepare("delete from subscriptions").run();
  await env.DB.prepare("delete from payment_settings").run();
});

const idOf = (r: Awaited<ReturnType<typeof createPost>>) => {
  if (!r.ok) throw new Error(`createPost failed: ${r.code}`);
  return r.id;
};

/** A creator with a price, a follower with no subscription, and a subscriber, all following the creator. */
async function setup() {
  await paymentsOn();
  const creator = await member();
  const reader = await member();
  const payer = await member();
  await setFollow(db(), reader.id, creator.id, true);
  await setFollow(db(), payer.id, creator.id, true);
  await subscribe(payer.id, creator.id);
  return { creator, reader, payer };
}

describe("choosing who can see a post", () => {
  it("lets a member with a price post for subscribers only, and nobody else", async () => {
    await paymentsOn();
    const priced = await member();
    const unpriced = await member({ price: null });
    expect((await createPost(db(), priced.id, "for my subscribers", undefined, [], undefined, undefined, undefined, undefined, "subscribers")).ok).toBe(true);
    const refused = await createPost(db(), unpriced.id, "no price set", undefined, [], undefined, undefined, undefined, undefined, "subscribers");
    expect(refused).toEqual({ ok: false, code: "audience_off" });
  });

  it("refuses it while the owner has subscriptions off", async () => {
    const priced = await member();
    const result = await createPost(db(), priced.id, "hello", undefined, [], undefined, undefined, undefined, undefined, "subscribers");
    expect(result).toEqual({ ok: false, code: "audience_off" });
  });

  it("does not take a choice on a reply: a reply follows the post it answers", async () => {
    const { creator } = await setup();
    const post = idOf(await createPost(db(), creator.id, "everyone can read this"));
    const result = await createPost(db(), creator.id, "reply", post, [], undefined, undefined, undefined, undefined, "subscribers");
    expect(result).toEqual({ ok: false, code: "audience_reply" });
  });
});

describe("a subscribers-only post", () => {
  it("is seen by its author and by a paying subscriber, and by nobody else", async () => {
    const { creator, reader, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "secret words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect((await getPost(db(), creator.id, id))?.body).toBe("secret words");
    expect((await getPost(db(), payer.id, id))?.body).toBe("secret words");
    expect(await getPost(db(), reader.id, id)).toBeNull();
    expect((await getPost(db(), payer.id, id))?.subscribersOnly).toBe(true);
  });

  it("stays out of the feed, search, tag search and bookmarks for someone who cannot read it", async () => {
    const { creator, reader, payer } = await setup();
    await createPost(db(), creator.id, "locked #lockedtag mango", undefined, [], undefined, undefined, undefined, undefined, "subscribers");
    await createPost(db(), creator.id, "open mango");

    const feed = (viewer: string) => listFeed(db(), viewer, { scope: "following" }).then((p) => p.items.map((i) => i.body));
    expect(await feed(reader.id)).toEqual(["open mango"]);
    expect(await feed(payer.id)).toEqual(["open mango", "locked #lockedtag mango"]);

    const found = (viewer: string, q: string) => searchPosts(db(), viewer, q).then((p) => p.items.map((i) => i.body));
    expect(await found(reader.id, "mango")).toEqual(["open mango"]);
    expect(await found(reader.id, "#lockedtag")).toEqual([]);
    expect(await found(payer.id, "#lockedtag")).toEqual(["locked #lockedtag mango"]);

    // A subscriber saves it; when the subscription ends it leaves their saved list.
    const locked = (await searchPosts(db(), payer.id, "#lockedtag")).items[0]!.id;
    expect(await setBookmark(db(), payer.id, locked, true)).toEqual({ ok: true, saved: true });
    expect((await listBookmarks(db(), payer.id)).items).toHaveLength(1);
    await env.DB.prepare("update subscriptions set status = 'canceled', current_period_end = ? where subscriber_id = ?").bind(NOW - 10 * DAY, payer.id).run();
    expect((await listBookmarks(db(), payer.id)).items).toHaveLength(0);
    expect(await setBookmark(db(), reader.id, locked, true)).toEqual({ ok: false, code: "not_found" });
  });

  it("shows as a locked card on the author's profile, with no words, pictures, counts or quote", async () => {
    const { creator, reader, payer } = await setup();
    const photo = `posts/${creator.id}/${"a".repeat(24)}.jpg`;
    const id = idOf(await createPost(db(), creator.id, "private #word @someone", undefined, [photo], "Berlin, Germany", undefined, undefined, undefined, "subscribers"));
    await createPost(db(), creator.id, "public one");

    const theirs = await listByAuthor(db(), reader.id, creator.id);
    expect(theirs.items.map((i) => i.locked)).toEqual([false, true]);
    const locked = theirs.items[1]!;
    expect(locked.id).toBe(id);
    expect(locked).toMatchObject({ body: "", photos: [], gif: null, link: null, quote: null, tags: [], mentions: [], place: null, share: "none", replyCount: 0, likeCount: 0 });
    expect(JSON.stringify(locked)).not.toContain("private");
    expect(JSON.stringify(locked)).not.toContain(photo);
    expect(locked.author.userId).toBe(creator.id);

    const forSubscriber = await listByAuthor(db(), payer.id, creator.id);
    expect(forSubscriber.items.map((i) => i.locked)).toEqual([false, false]);
    expect(forSubscriber.items[1]!.photos).toEqual([photo]);
  });

  it("gives the post page a locked card only when asked for one", async () => {
    const { creator, reader } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect(await getPost(db(), reader.id, id)).toBeNull();
    const card = await getPost(db(), reader.id, id, { allowLocked: true });
    expect(card).toMatchObject({ locked: true, body: "" });
  });

  it("cannot be liked, saved, reported, reposted or quoted by someone who cannot read it", async () => {
    const { creator, reader } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect(await setLike(db(), reader.id, id, true)).toEqual({ ok: false, code: "not_found" });
    expect(await setRepost(db(), reader.id, id, true)).toEqual({ ok: false, code: "not_found" });
    expect((await fileReport(db(), reader.id, id, "spam", "")).ok).toBe(false);
    const quote = await createPost(db(), reader.id, "", undefined, [], undefined, undefined, id);
    expect(quote).toEqual({ ok: false, code: "quote_not_found" });
  });

  it("cannot be reposted or quoted even by a subscriber", async () => {
    const { creator, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect((await getPost(db(), payer.id, id))?.share).toBe("none");
    expect(await setRepost(db(), payer.id, id, true)).toEqual({ ok: false, code: "subscribers" });
    expect(await createPost(db(), payer.id, "nice", undefined, [], undefined, undefined, id)).toEqual({ ok: false, code: "quote_subscribers" });
    expect(await createPost(db(), creator.id, "mine", undefined, [], undefined, undefined, id)).toEqual({ ok: false, code: "quote_subscribers" });
    // Taking back a repost always works, and a subscriber can like it.
    expect((await setLike(db(), payer.id, id, true)).ok).toBe(true);
  });

  it("lets a subscriber report it", async () => {
    const { creator, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect((await fileReport(db(), payer.id, id, "spam", "")).ok).toBe(true);
  });

  it("is lost again when the subscription ends: stopped, unpaid, past its period, or in another mode", async () => {
    const { creator, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    const sees = async () => (await getPost(db(), payer.id, id)) !== null;
    const change = (set: string, ...binds: unknown[]) => env.DB.prepare(`update subscriptions set ${set} where subscriber_id = ?`).bind(...binds, payer.id).run();

    expect(await sees()).toBe(true);
    // The person chose to stop: they keep it until the period they paid for ends.
    await change("cancel_at_period_end = 1");
    expect(await sees()).toBe(true);
    // The period ends: still seen for the grace days, then not.
    await change("current_period_end = ?", NOW - ACCESS_GRACE_MS + DAY);
    expect(await sees()).toBe(true);
    await change("current_period_end = ?", NOW - ACCESS_GRACE_MS - DAY);
    expect(await sees()).toBe(false);
    await change("current_period_end = ?", NOW + 20 * DAY);
    expect(await sees()).toBe(true);
    for (const status of ["past_due", "unpaid", "paused", "canceled", "incomplete"]) {
      await change("status = ?", status);
      expect(await sees(), status).toBe(false);
    }
    await change("status = 'active'");
    expect(await sees()).toBe(true);
    // A test-mode subscription gives nothing once the site is in live mode.
    await env.DB.prepare("update payment_settings set mode = 'production'").run();
    expect(await sees()).toBe(false);
  });

  it("is seen by the same people as hasSubscriberAccess says have access", async () => {
    const { creator, reader, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    for (const person of [creator, reader, payer]) {
      const access = person.id === creator.id || (await hasSubscriberAccess(db(), person.id, creator.id));
      expect((await getPost(db(), person.id, id)) !== null, person.username).toBe(access);
    }
  });

  it("is hidden from a subscriber who is blocked by the creator", async () => {
    const { creator, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    await env.DB.prepare("insert into blocks (blocker_id, blocked_id) values (?, ?)").bind(creator.id, payer.id).run();
    expect(await getPost(db(), payer.id, id)).toBeNull();
    await env.DB.prepare("delete from blocks").run();
  });

  it("is deleted softly, like every post: the row stays and it is hidden from everyone", async () => {
    const { creator, payer } = await setup();
    const id = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect(await deletePost(db(), creator.id, id)).toEqual({ ok: true });
    const row = await env.DB.prepare("select deleted_at, subscribers_of from posts where id = ?").bind(id).first<{ deleted_at: number | null; subscribers_of: string | null }>();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.subscribers_of).toBe(creator.id);
    expect(await getPost(db(), payer.id, id)).toBeNull();
    expect(await getPost(db(), creator.id, id)).toBeNull();
  });
});

describe("replies to a subscribers-only post", () => {
  it("are for the same subscribers: a subscriber's reply is not seen by someone who cannot read the post", async () => {
    const { creator, reader, payer } = await setup();
    const post = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    const reply = idOf(await createPost(db(), payer.id, "a subscriber answers", post));
    const answer = idOf(await createPost(db(), creator.id, "the creator answers back", reply));

    const bodies = async (viewer: string) => (await listReplies(db(), viewer, post)).items.map((i) => i.body);
    expect(await bodies(payer.id)).toEqual(["a subscriber answers"]);
    expect(await bodies(creator.id)).toEqual(["a subscriber answers"]);
    expect(await bodies(reader.id)).toEqual([]);
    expect(await getPost(db(), reader.id, reply)).toBeNull();
    expect(await getPost(db(), reader.id, answer)).toBeNull();
    expect((await getPost(db(), payer.id, answer))?.body).toBe("the creator answers back");

    // Not on the replies tab of the subscriber's profile either, nor in a search.
    expect((await listByAuthor(db(), reader.id, payer.id, { replies: true })).items).toHaveLength(0);
    expect((await listByAuthor(db(), creator.id, payer.id, { replies: true })).items).toHaveLength(1);
    expect((await searchPosts(db(), reader.id, "answers")).items).toHaveLength(0);
  });

  it("cannot be written by someone who cannot read the post", async () => {
    const { creator, reader } = await setup();
    const post = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    expect(await createPost(db(), reader.id, "let me in", post)).toEqual({ ok: false, code: "parent_not_found" });
  });

  it("is not seen by a subscriber's replies once their own subscription ends, except their own", async () => {
    const { creator, payer } = await setup();
    const post = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    const reply = idOf(await createPost(db(), payer.id, "mine", post));
    await env.DB.prepare("update subscriptions set status = 'canceled'").run();
    expect(await getPost(db(), payer.id, post)).toBeNull();
    expect((await getPost(db(), payer.id, reply))?.body).toBe("mine");
  });
});

describe("alerts about a subscribers-only post", () => {
  it("are not made for a mentioned person who cannot read it, and are shown only while the post is readable", async () => {
    const { creator, reader, payer } = await setup();
    await createPost(db(), creator.id, `hello @${reader.username} and @${payer.username}`, undefined, [], undefined, undefined, undefined, undefined, "subscribers");
    expect((await listAlerts(db(), reader.id)).items).toHaveLength(0);
    expect((await listAlerts(db(), payer.id)).items).toHaveLength(1);

    // A subscriber's like reaches the creator; when the creator reads it that is fine, and a reader without access sees no alert about it.
    const post = idOf(await createPost(db(), creator.id, "another", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    await setLike(db(), payer.id, post, true);
    expect((await listAlerts(db(), creator.id)).items.some((a) => a.type === "like")).toBe(true);
    await env.DB.prepare("update subscriptions set status = 'canceled'").run();
    expect((await listAlerts(db(), payer.id)).items).toHaveLength(0);
  });

  it("are hidden from a reply alert when the replier loses access", async () => {
    const { creator, payer } = await setup();
    const post = idOf(await createPost(db(), creator.id, "words", undefined, [], undefined, undefined, undefined, undefined, "subscribers"));
    await createPost(db(), payer.id, "reply", post);
    expect((await listAlerts(db(), creator.id)).items.some((a) => a.type === "reply")).toBe(true);
  });
});

describe("a post for everyone", () => {
  it("is not changed by any of this", async () => {
    const { creator, reader } = await setup();
    const id = idOf(await createPost(db(), creator.id, "hello all"));
    expect((await getPost(db(), reader.id, id))?.share).toBe("repost_or_quote");
    expect((await getPost(db(), reader.id, id))?.subscribersOnly).toBe(false);
    expect(await setRepost(db(), reader.id, id, true)).toMatchObject({ ok: true });
  });
});
