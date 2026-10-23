import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { posts, profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { approvePending, rejectPending } from "@/server/admin";
import { ensureInviteLink } from "@/server/invites";
import { setFollow } from "@/server/follows";
import { countUnreadAlerts, listAlerts, markAllAlertsRead } from "@/server/notifications";
import { createPost, deletePost, setLike } from "@/server/posts";
import { signUpWithInvite } from "@/server/sign-up";

const db = () => getDb(env.DB);
const authEnv = () => ({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });

let n = 0;
async function member(opts: { first?: string; role?: "admin" | "member"; status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `ntf${i}@example.com` });
  await db().insert(profiles).values({
    userId: id,
    username: `ntf_${i}`,
    firstName: opts.first ?? `Pal${i}`,
    lastName: "Alert",
    role: opts.role ?? "member",
    status: opts.status ?? "active",
  });
  return { id, username: `ntf_${i}` };
}

const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;
const alerts = async (userId: string) => (await listAlerts(db(), userId)).items;
const postBy = async (authorId: string, text = "a post to react to") => ((await createPost(db(), authorId, text)) as { id: string }).id;

describe("like alerts", () => {
  it("tells the author once however often it is sent, and takes it back on unlike", async () => {
    const author = await member();
    const fan = await member({ first: "Meera" });
    const id = await postBy(author.id);

    await setLike(db(), fan.id, id, true);
    await setLike(db(), fan.id, id, true);
    const [item] = await alerts(author.id);
    expect(await alerts(author.id)).toHaveLength(1);
    expect(item).toMatchObject({ type: "like", count: 1, unread: true, post: { id, authorUsername: author.username } });
    expect(item?.actors[0]).toMatchObject({ userId: fan.id, firstName: "Meera" });

    await setLike(db(), fan.id, id, false);
    await setLike(db(), fan.id, id, false);
    expect(await alerts(author.id)).toHaveLength(0);
  });

  it("does not alert you about liking your own post", async () => {
    const author = await member();
    const id = await postBy(author.id);
    await setLike(db(), author.id, id, true);
    expect(await alerts(author.id)).toHaveLength(0);
    expect(await count("select count(*) as n from notifications where actor_id = ?", author.id)).toBe(0);
  });

  it("collapses likes of one post into a single line, keeping the count and the first three people", async () => {
    const author = await member();
    const id = await postBy(author.id);
    const other = await postBy(author.id, "a different post");
    const fans = [];
    for (let i = 0; i < 5; i++) fans.push(await member());
    for (const fan of fans) await setLike(db(), fan.id, id, true);
    await setLike(db(), fans[0]!.id, other, true);

    const items = await alerts(author.id);
    expect(items).toHaveLength(2);
    const group = items.find((x) => x.post?.id === id)!;
    expect(group.count).toBe(5);
    expect(group.actors).toHaveLength(3);
    // Newest first: the last liker leads.
    expect(group.actors[0]?.userId).toBe(fans[4]!.id);
    expect(items.find((x) => x.post?.id === other)?.count).toBe(1);
  });
});

describe("follow alerts", () => {
  it("tells the person once and takes it back on unfollow", async () => {
    const a = await member();
    const b = await member({ first: "Ravi" });
    await setFollow(db(), a.id, b.id, true);
    await setFollow(db(), a.id, b.id, true);
    expect(await alerts(b.id)).toMatchObject([{ type: "follow", count: 1, post: null, actors: [{ userId: a.id }] }]);
    expect(await alerts(a.id)).toHaveLength(0);

    await setFollow(db(), a.id, b.id, false);
    expect(await alerts(b.id)).toHaveLength(0);
  });

  it("follows after an unfollow alert again", async () => {
    const a = await member();
    const b = await member();
    await setFollow(db(), a.id, b.id, true);
    await setFollow(db(), a.id, b.id, false);
    await setFollow(db(), a.id, b.id, true);
    expect(await alerts(b.id)).toHaveLength(1);
  });
});

describe("reply alerts", () => {
  it("tells the author of the post, pointing at the reply", async () => {
    const author = await member();
    const replier = await member();
    const id = await postBy(author.id);
    const reply = (await createPost(db(), replier.id, "my answer", id)) as { id: string };

    expect(await alerts(author.id)).toMatchObject([
      { type: "reply", post: { id: reply.id, body: "my answer", authorUsername: replier.username }, actors: [{ userId: replier.id }] },
    ]);
  });

  it("does not alert you about replying to yourself, and a reply to a reply goes to that author", async () => {
    const a = await member();
    const b = await member();
    const root = await postBy(a.id);
    await createPost(db(), a.id, "me again", root);
    expect(await alerts(a.id)).toHaveLength(0);

    const bReply = (await createPost(db(), b.id, "from b", root)) as { id: string };
    await createPost(db(), a.id, "a answers b", bReply.id);
    const forB = await alerts(b.id);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({ type: "reply", actors: [{ userId: a.id }] });
  });
});

describe("what is shown", () => {
  it("hides an alert about a post that was deleted", async () => {
    const author = await member();
    const fan = await member();
    const id = await postBy(author.id);
    await setLike(db(), fan.id, id, true);
    expect(await countUnreadAlerts(db(), author.id)).toBe(1);

    await deletePost(db(), author.id, id);
    expect(await alerts(author.id)).toHaveLength(0);
    expect(await countUnreadAlerts(db(), author.id)).toBe(0);
  });

  it("cuts nothing off the stored text, so the page decides the snippet", async () => {
    const author = await member();
    const fan = await member();
    const long = "word ".repeat(55).trim(); // 274 characters, under the 280 limit
    const id = await postBy(author.id, long);
    await setLike(db(), fan.id, id, true);
    expect((await alerts(author.id))[0]?.post?.body).toBe(long);
  });

  it("pages newest first by (time, id) without repeats, grouping inside each page", async () => {
    const author = await member();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const fan = await member();
      await setFollow(db(), fan.id, author.id, true);
      ids.push(fan.id);
    }
    const first = await listAlerts(db(), author.id, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAlerts(db(), author.id, { limit: 2, cursor: first.nextCursor });
    const third = await listAlerts(db(), author.id, { limit: 2, cursor: second.nextCursor });
    const seen = [...first.items, ...second.items, ...third.items].map((x) => x.actors[0]?.userId);
    expect(new Set(seen).size).toBe(5);
    expect(third.nextCursor).toBeNull();
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("ignores a cursor that is not one of ours", async () => {
    const author = await member();
    const fan = await member();
    await setFollow(db(), fan.id, author.id, true);
    for (const bad of ["x", "1_post_" + "a".repeat(24), "999_ntf_short", 42, null]) {
      expect((await listAlerts(db(), author.id, { cursor: bad })).items).toHaveLength(1);
    }
  });

  it("shows each person only their own alerts", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await setFollow(db(), a.id, b.id, true);
    expect(await alerts(c.id)).toHaveLength(0);
    expect(await countUnreadAlerts(db(), c.id)).toBe(0);
  });
});

describe("unread and read", () => {
  it("counts unread alerts and marks them all read, and repeating changes nothing", async () => {
    const author = await member();
    const f1 = await member();
    const f2 = await member();
    await setFollow(db(), f1.id, author.id, true);
    await setFollow(db(), f2.id, author.id, true);
    expect(await countUnreadAlerts(db(), author.id)).toBe(2);

    await markAllAlertsRead(db(), author.id);
    await markAllAlertsRead(db(), author.id);
    expect(await countUnreadAlerts(db(), author.id)).toBe(0);
    const items = await alerts(author.id);
    expect(items).toHaveLength(2);
    expect(items.every((x) => !x.unread)).toBe(true);
  });

  it("marks only the reader's own alerts", async () => {
    const a = await member();
    const b = await member();
    const fan = await member();
    await setFollow(db(), fan.id, a.id, true);
    await setFollow(db(), fan.id, b.id, true);
    await markAllAlertsRead(db(), a.id);
    expect(await countUnreadAlerts(db(), a.id)).toBe(0);
    expect(await countUnreadAlerts(db(), b.id)).toBe(1);
  });

  it("a later like on an already-read post alerts again only when it is a new person", async () => {
    const author = await member();
    const f1 = await member();
    const f2 = await member();
    const id = await postBy(author.id);
    await setLike(db(), f1.id, id, true);
    await markAllAlertsRead(db(), author.id);
    await setLike(db(), f1.id, id, true);
    expect(await countUnreadAlerts(db(), author.id)).toBe(0);
    await setLike(db(), f2.id, id, true);
    expect(await countUnreadAlerts(db(), author.id)).toBe(1);
  });
});

describe("sign-up alerts", () => {
  async function owner(role: "admin" | "member") {
    const i = ++n;
    const { user: made } = await createAuth(authEnv()).api.signUpEmail({
      body: { email: `own${i}@example.com`, password: "a-long-enough-pass", name: "Owner Person" },
    });
    await db().insert(profiles).values({ userId: made.id, username: `own_${i}`, firstName: "Olive", lastName: "Owner", role, status: "active" });
    return { id: made.id, link: await ensureInviteLink(db(), made.id) };
  }

  const join = (code: string, k: number) =>
    signUpWithInvite(authEnv(), {
      invite: code,
      firstName: "Newbie",
      lastName: `Joiner${k}`,
      email: `newbie${code.slice(0, 5)}${k}@example.com`.toLowerCase(),
      username: `nb_${code.slice(0, 4).toLowerCase()}_${k}`,
      password: "a-long-enough-pass",
    });

  it("tells the link's owner it was used, and the admin when the sign-up is waiting", async () => {
    // One admin exists in this database for the whole file (the database allows only one).
    const adminRow = await env.DB.prepare("select user_id from profiles where role = 'admin'").first<{ user_id: string }>();
    const admin = adminRow ? { id: adminRow.user_id } : await owner("admin");
    const mem = await owner("member");

    // There is no instance row here, so the quota is the default of 5: the first five join, the rest wait.
    const results = [];
    for (let k = 0; k < 7; k++) results.push(await join(mem.link.code, k));
    expect(results.every((r) => r.ok)).toBe(true);
    const statuses = results.map((r) => (r.ok ? r.status : "failed"));
    expect(statuses.slice(0, 5).every((s) => s === "active")).toBe(true);
    expect(statuses.slice(5)).toEqual(["pending", "pending"]);

    const forOwner = await alerts(mem.id);
    expect(forOwner.filter((x) => x.type === "invite_used")).toHaveLength(7);

    const pendingIds = results.slice(5).map((r) => (r.ok ? r.userId : ""));
    const forAdmin = (await alerts(admin.id)).filter((x) => x.type === "pending_approval");
    expect(forAdmin.map((x) => x.actors[0]?.userId).sort()).toEqual([...pendingIds].sort());
    expect(forAdmin.every((x) => x.actors[0]?.active === false)).toBe(true);

    // Approving removes that person's alert for the admin; rejecting removes it with the account.
    expect(await approvePending(db(), pendingIds[0]!)).toEqual({ ok: true });
    expect(await approvePending(db(), pendingIds[0]!)).toEqual({ ok: false, code: "not_pending" });
    expect(await rejectPending(db(), pendingIds[1]!)).toEqual({ ok: true });
    expect((await alerts(admin.id)).filter((x) => x.type === "pending_approval").map((x) => x.actors[0]?.userId)).not.toContain(pendingIds[0]);
    expect(await count("select count(*) as n from notifications where actor_id in (?, ?) and type = 'pending_approval'", pendingIds[0]!, pendingIds[1]!)).toBe(0);
    // The owner's "invite used" alert for the approved person stays.
    expect((await alerts(mem.id)).some((x) => x.actors[0]?.userId === pendingIds[0])).toBe(true);
  });

  it("writes nothing when the link is not valid", async () => {
    const before = await count("select count(*) as n from notifications");
    const result = await join("x".repeat(32), 99);
    expect(result.ok).toBe(false);
    expect(await count("select count(*) as n from notifications")).toBe(before);
  });
});

describe("the database itself", () => {
  const insert = (fields: { recipient: string; actor: string; type: string; post?: string | null }) =>
    env.DB.prepare("insert into notifications (id, recipient_id, actor_id, type, post_id) values (?, ?, ?, ?, ?)")
      .bind(newId("notification"), fields.recipient, fields.actor, fields.type, fields.post ?? null)
      .run();

  it("refuses an alert about your own action", async () => {
    const a = await member();
    await expect(insert({ recipient: a.id, actor: a.id, type: "follow" })).rejects.toThrow();
  });

  it("refuses a kind it does not know", async () => {
    const a = await member();
    const b = await member();
    await expect(insert({ recipient: a.id, actor: b.id, type: "poke" })).rejects.toThrow();
  });

  it("wants a post for post alerts and none for people alerts", async () => {
    const a = await member();
    const b = await member();
    const id = await postBy(a.id);
    await expect(insert({ recipient: a.id, actor: b.id, type: "like", post: null })).rejects.toThrow();
    await expect(insert({ recipient: a.id, actor: b.id, type: "follow", post: id })).rejects.toThrow();
    await expect(insert({ recipient: a.id, actor: b.id, type: "like", post: id })).resolves.toBeDefined();
    await expect(insert({ recipient: a.id, actor: b.id, type: "follow", post: null })).resolves.toBeDefined();
  });

  it("refuses the same alert twice, with or without a post", async () => {
    const a = await member();
    const b = await member();
    const id = await postBy(a.id);
    await insert({ recipient: a.id, actor: b.id, type: "like", post: id });
    await insert({ recipient: a.id, actor: b.id, type: "follow" });
    await expect(insert({ recipient: a.id, actor: b.id, type: "like", post: id })).rejects.toThrow();
    await expect(insert({ recipient: a.id, actor: b.id, type: "follow" })).rejects.toThrow();
  });

  it("removes alerts with the person or the post they are about", async () => {
    const a = await member();
    const b = await member();
    const id = await postBy(a.id);
    await setLike(db(), b.id, id, true);
    await setFollow(db(), b.id, a.id, true);
    expect(await count("select count(*) as n from notifications where recipient_id = ?", a.id)).toBe(2);

    await db().delete(posts).where(eq(posts.id, id));
    expect(await count("select count(*) as n from notifications where recipient_id = ?", a.id)).toBe(1);
    await db().delete(user).where(eq(user.id, b.id));
    expect(await count("select count(*) as n from notifications where recipient_id = ?", a.id)).toBe(0);
  });
});
