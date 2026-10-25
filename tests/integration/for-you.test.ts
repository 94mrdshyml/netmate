import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { FEED } from "@/lib/feed-score";
import { newId } from "@/lib/ids";
import { setBookmark } from "@/server/bookmarks";
import { setFollow } from "@/server/follows";
import { decodeForYouCursor, encodeForYouCursor, listForYou } from "@/server/for-you";
import { createPost, deletePost, setLike, setRepost } from "@/server/posts";
import { setBlock, setMute, setPrivate } from "@/server/privacy";
import { markSeen, SEEN_BATCH_MAX } from "@/server/seen";

const db = () => getDb(env.DB);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `fy${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `fy_${i}`, firstName: `Fey${i}`, lastName: "You" });
  return { id, username: `fy_${i}` };
}
type Person = Awaited<ReturnType<typeof member>>;

/** A top-level post made `ageMs` ago. */
async function post(author: Person, text: string, ageMs = 0): Promise<string> {
  const r = await createPost(db(), author.id, text);
  if (!r.ok) throw new Error(`createPost: ${r.code}`);
  if (ageMs > 0) await env.DB.prepare("update posts set created_at = ? where id = ?").bind(Date.now() - ageMs, r.id).run();
  return r.id;
}

/** Every entry of the feed, page after page. */
async function everything(viewer: Person, now?: number) {
  const out: Awaited<ReturnType<typeof listForYou>>["items"] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const res: Awaited<ReturnType<typeof listForYou>> = await listForYou(db(), viewer.id, { cursor: cursor ?? undefined, now });
    out.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}
const ids = async (viewer: Person) => (await everything(viewer)).map((p) => p.id);

/** Makes the viewer's feed big enough that strangers need traction (a small feed lets them in so it is never empty). */
async function bigFeed(viewer: Person) {
  const friend = await member();
  await setFollow(db(), viewer.id, friend.id, true);
  for (let i = 0; i < FEED.fillBelow + 2; i++) await post(friend, `filler ${n} ${i}`, (i + 1) * 60_000);
  return friend;
}

let subs = 0;
async function subscribe(subscriberId: string, creatorId: string) {
  await env.DB.prepare("insert or replace into payment_settings (id, enabled, mode) values ('singleton', 1, 'sandbox')").run();
  await env.DB.prepare(
    "insert into subscriptions (id, polar_id, mode, subscriber_id, creator_id, status, price_cents, current_period_end, polar_modified_at) values (?, ?, 'sandbox', ?, ?, 'active', 500, ?, ?)",
  )
    .bind(newId("subscription"), `fy_${++subs}_${Date.now()}`, subscriberId, creatorId, Date.now() + 20 * DAY, Date.now())
    .run();
}

afterEach(async () => {
  await env.DB.prepare("delete from subscriptions").run();
  await env.DB.prepare("delete from payment_settings").run();
});

describe("who can be in For you", () => {
  it("holds your own posts and the posts of people you follow, and not replies, deleted posts or posts older than seven days", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    const mine = await post(me, "mine");
    const theirs = await post(friend, "theirs");
    const old = await post(friend, "old", 8 * DAY);
    const gone = await post(friend, "gone");
    await deletePost(db(), friend.id, gone);
    const reply = (await createPost(db(), friend.id, "a reply", theirs)) as { id: string };

    const got = await ids(me);
    expect(got).toContain(mine);
    expect(got).toContain(theirs);
    expect(got).not.toContain(old);
    expect(got).not.toContain(gone);
    expect(got).not.toContain(reply.id);
  });

  it("leaves out anyone you blocked or who blocked you, anyone you muted, and a private account you do not follow", async () => {
    const me = await member();
    await bigFeed(me);
    const blocked = await member();
    const blocker = await member();
    const muted = await member();
    const hidden = await member();
    for (const p of [blocked, blocker, muted, hidden]) await setFollow(db(), me.id, p.id, true);
    const posts = {
      blocked: await post(blocked, "b"),
      blocker: await post(blocker, "r"),
      muted: await post(muted, "m"),
      hidden: await post(hidden, "h"),
    };
    await setBlock(db(), me.id, blocked.id, true);
    await setBlock(db(), blocker.id, me.id, true);
    await setMute(db(), me.id, muted.id, true);
    await setPrivate(db(), hidden.id, true);
    await setFollow(db(), me.id, hidden.id, false);

    const got = await ids(me);
    for (const [name, id] of Object.entries(posts)) expect(got, name).not.toContain(id);
  });

  it("shows a stranger's post only with traction, marks it suggested, and never marks a followed person's post", async () => {
    const me = await member();
    const friend = await bigFeed(me);
    const stranger = await member();
    const quiet = await post(stranger, "nobody reacted");
    const busy = await post(stranger, "two reactions");
    const one = await member();
    const two = await member();
    await setLike(db(), one.id, busy, true);
    await setRepost(db(), two.id, busy, true);
    const friendsPick = await post(stranger, "my friend liked this");
    await setLike(db(), friend.id, friendsPick, true);
    const oneLike = await post(stranger, "just one like");
    await setLike(db(), one.id, oneLike, true);

    const feed = await everything(me);
    const got = feed.map((p) => p.id);
    expect(got).not.toContain(quiet);
    expect(got).not.toContain(oneLike);
    expect(got).toContain(busy);
    expect(got).toContain(friendsPick);
    expect(feed.find((p) => p.id === busy)?.suggested).toBe(true);
    expect(feed.find((p) => p.id === friendsPick)?.suggested).toBe(true);
    const fillers = feed.filter((p) => p.author.userId === friend.id);
    expect(fillers.length).toBeGreaterThan(0);
    expect(fillers.every((p) => !p.suggested)).toBe(true);
  });

  it("lets strangers' recent posts in without traction while the feed is small, so it is never empty", async () => {
    const me = await member();
    const stranger = await member();
    const quiet = await post(stranger, "nobody reacted, but the feed is small");
    const feed = await everything(me);
    expect(feed.map((p) => p.id)).toContain(quiet);
    expect(feed.find((p) => p.id === quiet)?.suggested).toBe(true);
  });

  it("never suggests a private account's post or a stranger's post for subscribers only", async () => {
    const me = await member();
    const stranger = await member();
    const secret = await member();
    await setPrivate(db(), secret.id, true);
    const hidden = await post(secret, "private");
    await env.DB.prepare("insert or replace into payment_settings (id, enabled, mode) values ('singleton', 1, 'sandbox')").run();
    await env.DB.prepare("update profiles set subscription_price_cents = 500 where user_id = ?").bind(stranger.id).run();
    const gated = (await createPost(db(), stranger.id, "for subscribers", undefined, [], undefined, undefined, undefined, undefined, "subscribers")) as { id: string };
    expect(await ids(me)).not.toContain(hidden);
    expect(await ids(me)).not.toContain(gated.id);
  });

  it("shows a followed creator's post for subscribers only to a paying subscriber, and not to a follower who does not pay", async () => {
    const payer = await member();
    const follower = await member();
    const creator = await member();
    await env.DB.prepare("insert or replace into payment_settings (id, enabled, mode) values ('singleton', 1, 'sandbox')").run();
    await env.DB.prepare("update profiles set subscription_price_cents = 500 where user_id = ?").bind(creator.id).run();
    for (const p of [payer, follower]) await setFollow(db(), p.id, creator.id, true);
    await subscribe(payer.id, creator.id);
    const gated = (await createPost(db(), creator.id, "members only", undefined, [], undefined, undefined, undefined, undefined, "subscribers")) as { id: string };
    expect(await ids(payer)).toContain(gated.id);
    expect(await ids(follower)).not.toContain(gated.id);
  });
});

describe("reposts in For you", () => {
  it("shows what someone you follow reposted, with who did it, and not as a suggestion", async () => {
    const me = await member();
    const friend = await member();
    const stranger = await member();
    await setFollow(db(), me.id, friend.id, true);
    const theirs = await post(stranger, "worth sharing");
    await setRepost(db(), friend.id, theirs, true);
    const item = (await everything(me)).find((p) => p.id === theirs);
    expect(item?.repostedBy?.userId).toBe(friend.id);
    expect(item?.suggested).toBe(false);
  });

  it("shows a post once even when it is both a followed person's own post and someone's repost", async () => {
    const me = await member();
    const a = await member();
    const b = await member();
    await setFollow(db(), me.id, a.id, true);
    await setFollow(db(), me.id, b.id, true);
    const id = await post(a, "twice over");
    await setRepost(db(), b.id, id, true);
    expect((await ids(me)).filter((x) => x === id)).toHaveLength(1);
  });

  it("leaves out a repost by someone you muted, and a repost of a post you cannot see", async () => {
    const me = await member();
    const friend = await member();
    const muted = await member();
    const stranger = await member();
    await setFollow(db(), me.id, friend.id, true);
    await setFollow(db(), me.id, muted.id, true);
    const a = await post(stranger, "reposted by a muted person");
    await setRepost(db(), muted.id, a, true);
    await setMute(db(), me.id, muted.id, true);
    const b = await post(stranger, "reposted, then the author blocked me");
    await setRepost(db(), friend.id, b, true);
    await setBlock(db(), stranger.id, me.id, true);
    const got = await ids(me);
    expect(got).not.toContain(a);
    expect(got).not.toContain(b);
  });
});

describe("the order", () => {
  it("puts a post you have already seen below one you have not", async () => {
    const me = await member();
    const a = await member();
    const b = await member();
    await setFollow(db(), me.id, a.id, true);
    await setFollow(db(), me.id, b.id, true);
    const pa = await post(a, "from a");
    const pb = await post(b, "from b");
    const at = Date.now() - HOUR;
    await env.DB.prepare("update posts set created_at = ? where id in (?, ?)").bind(at, pa, pb).run();

    const before = (await ids(me)).filter((x) => x === pa || x === pb);
    const [first, second] = before as [string, string];
    expect(await markSeen(db(), me.id, [first])).toBe(1);
    const after = (await ids(me)).filter((x) => x === pa || x === pb);
    expect(after).toEqual([second, first]);
  });

  it("keeps what one member saw to that member: someone else's feed does not change", async () => {
    const me = await member();
    const other = await member();
    const author = await member();
    await setFollow(db(), me.id, author.id, true);
    await setFollow(db(), other.id, author.id, true);
    const first = await post(author, "first", 2 * HOUR);
    const second = await post(author, "second", HOUR);
    const otherBefore = await ids(other);
    await markSeen(db(), me.id, [first, second]);
    expect(await ids(other)).toEqual(otherBefore);
  });

  for (const kind of ["like", "save", "repost", "reply"] as const) {
    it(`lifts the posts of an author you lately reacted to by a ${kind}`, async () => {
      const me = await member();
      const a = await member();
      const b = await member();
      await setFollow(db(), me.id, a.id, true);
      await setFollow(db(), me.id, b.id, true);
      const pa = await post(a, "from a");
      const pb = await post(b, "from b");
      await env.DB.prepare("update posts set created_at = ? where id in (?, ?)").bind(Date.now() - HOUR, pa, pb).run();
      const order = (await ids(me)).filter((x) => x === pa || x === pb);
      const lower = order[1] === pa ? a : b;
      // An older post of the one that is second now (older than seven days, so not in the feed itself) gets the reaction.
      const older = await post(lower, "older", 9 * DAY);
      if (kind === "like") await setLike(db(), me.id, older, true);
      if (kind === "save") await setBookmark(db(), me.id, older, true);
      if (kind === "repost") {
        // Reposted ten days ago: out of the seven-day feed, but inside the thirty days that count toward closeness.
        await setRepost(db(), me.id, older, true);
        await env.DB.prepare("update reposts set created_at = ? where user_id = ? and post_id = ?").bind(Date.now() - 10 * DAY, me.id, older).run();
      }
      if (kind === "reply") await createPost(db(), me.id, "a reply from me", older);
      const after = await ids(me);
      expect(after.filter((x) => x === pa || x === pb)[0]).toBe(order[1]);
    });
  }

  it("counts a busy author's second post for less, so one author cannot fill the feed", async () => {
    const me = await member();
    const busy = await member();
    const other = await member();
    await setFollow(db(), me.id, busy.id, true);
    await setFollow(db(), me.id, other.id, true);
    const b1 = await post(busy, "b1", 3 * HOUR);
    const b2 = await post(busy, "b2", 3 * HOUR + 60_000);
    const o1 = await post(other, "o1", 5 * HOUR);
    // Without the rule b2 (fresher than o1) would be second; with it b2 counts 0.7 and o1 is older by about 5h versus 3h, so they swap.
    const got = (await ids(me)).filter((x) => [b1, b2, o1].includes(x));
    expect(got[0]).toBe(b1);
    expect(got.indexOf(o1)).toBeLessThan(got.indexOf(b2));
  });
});

describe("paging", () => {
  it("gives pages of twenty with no post twice, ending with no next page", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    const made: string[] = [];
    for (let i = 0; i < 45; i++) made.push(await post(friend, `p${i}`, (i + 1) * 60_000));
    const first = await listForYou(db(), me.id, {});
    expect(first.items).toHaveLength(FEED.pageSize);
    expect(first.nextCursor).not.toBeNull();
    const all = await ids(me);
    expect(new Set(all).size).toBe(all.length);
    for (const id of made) expect(all).toContain(id);
    const last = await listForYou(db(), me.id, { cursor: `fy_${decodeForYouCursor(first.nextCursor, Date.now())!.asOf}_${Math.floor(all.length / FEED.pageSize) * FEED.pageSize}` });
    expect(last.nextCursor).toBeNull();
  });

  it("keeps the ranking of the first page while you scroll: a post made later does not shift the next page", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    for (let i = 0; i < 30; i++) await post(friend, `q${i}`, (i + 1) * 60_000);
    const first = await listForYou(db(), me.id, {});
    const late = await post(friend, "made while scrolling");
    const second = await listForYou(db(), me.id, { cursor: first.nextCursor! });
    expect(second.items.map((p) => p.id)).not.toContain(late);
    expect(second.items.some((p) => first.items.some((f) => f.id === p.id))).toBe(false);
    // A fresh look starts again and has it.
    expect((await ids(me))).toContain(late);
  });

  it("does not let views recorded while scrolling reshuffle what is coming", async () => {
    const me = await member();
    const friend = await member();
    await setFollow(db(), me.id, friend.id, true);
    for (let i = 0; i < 30; i++) await post(friend, `r${i}`, (i + 1) * 60_000);
    const first = await listForYou(db(), me.id, {});
    const nextBefore = (await listForYou(db(), me.id, { cursor: first.nextCursor! })).items.map((p) => p.id);
    await markSeen(db(), me.id, nextBefore.slice(0, 5));
    const nextAfter = (await listForYou(db(), me.id, { cursor: first.nextCursor! })).items.map((p) => p.id);
    expect(nextAfter).toEqual(nextBefore);
  });

  it("starts again on a cursor that is not ours, is from the future, or is more than two hours old", () => {
    const now = Date.now();
    expect(decodeForYouCursor("garbage", now)).toBeNull();
    expect(decodeForYouCursor(42, now)).toBeNull();
    expect(decodeForYouCursor(encodeForYouCursor(now + 5000, 20), now)).toBeNull();
    expect(decodeForYouCursor(encodeForYouCursor(now - FEED.cursorMaxAgeMs - 1, 20), now)).toBeNull();
    expect(decodeForYouCursor(encodeForYouCursor(now - 1000, 20), now)).toEqual({ asOf: now - 1000, offset: 20 });
    expect(decodeForYouCursor("fy_1_99999", now)).toBeNull();
  });
});

describe("what the phone reports as seen", () => {
  it("keeps only posts this member may see, drops anything that is not a post id, and does the same thing twice", async () => {
    const me = await member();
    const author = await member();
    const secret = await member();
    await setPrivate(db(), secret.id, true);
    const open = await post(author, "open");
    const hidden = await post(secret, "private");
    const gone = await post(author, "gone");
    await deletePost(db(), author.id, gone);

    expect(await markSeen(db(), me.id, [open, hidden, gone, "nope", 5, null, open])).toBe(3);
    expect(await markSeen(db(), me.id, [open])).toBe(1);
    const rows = await env.DB.prepare("select post_id from post_seen where user_id = ? order by post_id").bind(me.id).all<{ post_id: string }>();
    expect(rows.results.map((r) => r.post_id)).toEqual([open]);
    expect(await markSeen(db(), me.id, "not a list")).toBe(0);
    expect(await markSeen(db(), me.id, [])).toBe(0);
  });

  it("looks at no more than forty ids in one report", async () => {
    const me = await member();
    const author = await member();
    const made: string[] = [];
    for (let i = 0; i < SEEN_BATCH_MAX + 5; i++) made.push(await post(author, `s${i}`));
    expect(await markSeen(db(), me.id, made)).toBe(SEEN_BATCH_MAX);
    const row = await env.DB.prepare("select count(*) as n from post_seen where user_id = ?").bind(me.id).first<{ n: number }>();
    expect(row?.n).toBe(SEEN_BATCH_MAX);
  });

  it("removes what is older than seven days whenever anyone reports a view, and leaves newer rows", async () => {
    const me = await member();
    const other = await member();
    const author = await member();
    const a = await post(author, "a");
    const b = await post(author, "b");
    await markSeen(db(), other.id, [a], Date.now() - 8 * DAY);
    await markSeen(db(), other.id, [b], Date.now() - DAY);
    await markSeen(db(), me.id, [a]);
    const rows = await env.DB.prepare("select user_id, post_id from post_seen where user_id in (?, ?)").bind(me.id, other.id).all<{ user_id: string; post_id: string }>();
    expect(rows.results.filter((r) => r.user_id === other.id).map((r) => r.post_id)).toEqual([b]);
    expect(rows.results.filter((r) => r.user_id === me.id)).toHaveLength(1);
  });

  it("goes with the member when their account goes", async () => {
    const me = await member();
    const author = await member();
    await markSeen(db(), me.id, [await post(author, "x")]);
    await env.DB.prepare("delete from user where id = ?").bind(me.id).run();
    const row = await env.DB.prepare("select count(*) as n from post_seen where user_id = ?").bind(me.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
