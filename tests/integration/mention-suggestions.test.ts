import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setFollow } from "@/server/follows";
import { existingMentions, MENTION_SUGGESTIONS, suggestMentions } from "@/server/mentions";
import { LIMITS, limitMentions } from "@/server/rate-limit";
import { setBlock } from "@/server/privacy";

const db = () => getDb(env.DB);

// Each test file gets one set of people, so the prefix of a name is unique to this file.
let n = 0;
async function member(opts: { username?: string; first?: string; last?: string; status?: "active" | "pending"; isPrivate?: boolean } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `ms${i}@example.com` });
  const username = opts.username ?? `ms_${i}`;
  await db().insert(profiles).values({
    userId: id,
    username,
    firstName: opts.first ?? `Mia${i}`,
    lastName: opts.last ?? "Mention",
    status: opts.status ?? "active",
    isPrivate: opts.isPrivate ?? false,
  });
  return { id, username };
}

const names = async (viewerId: string, prefix: string) => (await suggestMentions(db(), viewerId, prefix)).map((p) => p.username);
const tick = () => new Promise((r) => setTimeout(r, 4));

describe("suggestions for an @name", () => {
  it("match a username, a first name or a last name by its start, in either case, and never yourself", async () => {
    const me = await member({ username: "zq_me", first: "Zed", last: "Me" });
    const a = await member({ username: "zqriya", first: "Ria", last: "Zoe" });
    const b = await member({ username: "zqother", first: "Zqueen", last: "Other" });
    const c = await member({ username: "zqlast", first: "Lee", last: "ZQuinn" });
    expect((await names(me.id, "zq")).sort()).toEqual([a.username, b.username, c.username, "zq_me"].filter((u) => u !== "zq_me").sort());
    expect(await names(me.id, "ZQRIYA")).toEqual([a.username]);
    // First and last names count, so someone is found by the name people know them by.
    expect(await names(me.id, "zqueen")).toEqual([b.username]);
    expect(await names(me.id, "zquinn")).toEqual([c.username]);
    expect(await names(me.id, "nomatchatall")).toEqual([]);
  });

  it("put an exact username first, then usernames, then names, and people you follow ahead of others", async () => {
    const me = await member();
    const exact = await member({ username: "kay", first: "Zzz", last: "Zzz" });
    const startsWith = await member({ username: "kayla_x", first: "Zzz", last: "Zzz" });
    const byName = await member({ username: "zzz_1", first: "Kay", last: "Zzz" });
    const followed = await member({ username: "kayne", first: "Zzz", last: "Zzz" });
    await setFollow(db(), me.id, followed.id, true);
    // The exact username, then the two usernames that start with it (the one you follow first), then the name match.
    expect(await names(me.id, "kay")).toEqual([exact.username, followed.username, startsWith.username, byName.username]);
  });

  it("with nothing typed show the people you follow, the latest follow first, then the newest members", async () => {
    const me = await member();
    const first = await member({ username: "fo_one" });
    const second = await member({ username: "fo_two" });
    await setFollow(db(), me.id, first.id, true);
    await tick();
    await setFollow(db(), me.id, second.id, true);
    const stranger = await member({ username: "fo_new" });
    const got = await names(me.id, "");
    expect(got.slice(0, 2)).toEqual([second.username, first.username]);
    expect(got).toContain(stranger.username);
    expect(got).not.toContain(me.username);
    expect(got.length).toBeLessThanOrEqual(MENTION_SUGGESTIONS);
  });

  it("show at most six people", async () => {
    const me = await member();
    for (let i = 0; i < 9; i++) await member({ username: `many_${i}` });
    expect(await names(me.id, "many")).toHaveLength(MENTION_SUGGESTIONS);
  });

  it("leave out people who are not active members, and anyone with a block either way", async () => {
    const me = await member();
    const waiting = await member({ username: "hid_waiting", status: "pending" });
    const iBlocked = await member({ username: "hid_iblocked" });
    const blockedMe = await member({ username: "hid_blockedme" });
    const fine = await member({ username: "hid_fine" });
    await setBlock(db(), me.id, iBlocked.id, true);
    await setBlock(db(), blockedMe.id, me.id, true);
    expect(await names(me.id, "hid")).toEqual([fine.username]);
    expect(waiting.username).toBe("hid_waiting");
  });

  it("include a private account, whose header is visible to everyone", async () => {
    const me = await member();
    const priv = await member({ username: "pv_closed", isPrivate: true });
    expect(await names(me.id, "pv_")).toEqual([priv.username]);
  });

  it("treat an underscore as a letter, not a wildcard, and refuse anything that is not a username start", async () => {
    const me = await member();
    await member({ username: "ab_cd" });
    await member({ username: "abxcd" });
    expect(await names(me.id, "ab_")).toEqual(["ab_cd"]);
    for (const bad of ["a b", "a%", "a-b", "x".repeat(16), "'; drop table profiles; --", 5, null, undefined]) {
      expect(await suggestMentions(db(), me.id, bad)).toEqual([]);
    }
  });

  it("carry no email, bio or private detail, only what a mention link needs", async () => {
    const me = await member();
    await member({ username: "shape_a" });
    const [person] = await suggestMentions(db(), me.id, "shape_a");
    expect(Object.keys(person!).sort()).toEqual(["avatarKey", "firstName", "iFollow", "lastName", "userId", "username"]);
  });
});

describe("checking typed @names", () => {
  it("returns the ones that belong to a person who can be mentioned, lower-cased", async () => {
    const me = await member();
    const real = await member({ username: "chk_real" });
    const waiting = await member({ username: "chk_wait", status: "pending" });
    const blocked = await member({ username: "chk_blk" });
    await setBlock(db(), me.id, blocked.id, true);
    const found = await existingMentions(db(), me.id, ["CHK_REAL", "chk_wait", "chk_blk", "chk_nobody", real.username]);
    expect(found).toEqual([real.username]);
    expect(waiting.id).toBeTruthy();
  });

  it("counts yourself, since your own name still links", async () => {
    const me = await member({ username: "chk_self" });
    expect(await existingMentions(db(), me.id, ["chk_self"])).toEqual(["chk_self"]);
  });

  it("checks at most ten names and ignores anything that is not a username", async () => {
    const me = await member();
    const many = [];
    for (let i = 0; i < 12; i++) many.push((await member({ username: `cap_${String(i).padStart(2, "0")}` })).username);
    expect(await existingMentions(db(), me.id, many)).toHaveLength(10);
    expect(await existingMentions(db(), me.id, ["a", "x".repeat(16), "no spaces", "", 5, null])).toEqual([]);
    expect(await existingMentions(db(), me.id, "not a list")).toEqual([]);
  });
});

describe("the suggestion limit", () => {
  it("allows 120 lookups a minute per person and then asks to wait, for that person only", async () => {
    const SALT = "test-salt-for-mentions";
    const T0 = 1_800_000_000_000;
    expect(LIMITS.mentions).toMatchObject({ max: 120, windowMs: 60_000 });
    for (let i = 0; i < 120; i++) expect(await limitMentions(env.DB, SALT, "usr_one", T0 + i)).toEqual({ ok: true });
    expect(await limitMentions(env.DB, SALT, "usr_one", T0 + 200)).toMatchObject({ ok: false });
    expect(await limitMentions(env.DB, SALT, "usr_two", T0 + 200)).toEqual({ ok: true });
    expect(await limitMentions(env.DB, SALT, "usr_one", T0 + 61_000)).toEqual({ ok: true });
  });
});
