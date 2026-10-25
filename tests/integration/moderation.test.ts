import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Auth } from "@/auth";
import { signInMember } from "@/auth/sign-in";
import { getDb } from "@/db";
import { profiles, session, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { listFeed, createPost, getPost } from "@/server/posts";
import { listMembers } from "@/server/members";
import { liftSuspension, removePostFromCase, suspendMember } from "@/server/moderation";
import { countUnreadAlerts, listAlerts } from "@/server/notifications";
import { getProfile } from "@/server/profiles";
import { closeCase, fileReport, getCase, listMyReports, reopenCase } from "@/server/reports";
import { searchPeople } from "@/server/search";

const db = () => getDb(env.DB);
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

let n = 0;
async function person(over: { role?: "admin" | "member"; moderator?: boolean; status?: "active" | "pending" } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `md${i}@example.com` });
  await db()
    .insert(profiles)
    .values({ userId: id, username: `mod_${i}`, firstName: `Mo${i}`, lastName: "Dee", role: over.role ?? "member", isModerator: over.moderator ?? false, status: over.status ?? "active" });
  return { id, username: `mod_${i}` };
}
type Person = Awaited<ReturnType<typeof person>>;

let sharedAdmin: Person | null = null;
const theAdmin = async () => (sharedAdmin ??= await person({ role: "admin" }));
const asAdmin = async () => ({ userId: (await theAdmin()).id, isAdmin: true });
const asMod = (p: { id: string }) => ({ userId: p.id, isAdmin: false });

const postOf = async (author: Person, text = "a post worth a look", parentId?: string) => {
  const r = await createPost(db(), author.id, text, parentId);
  if (!r.ok) throw new Error(r.code);
  return r.id;
};
const report = async (reporter: Person, postId: string, category = "spam") => {
  const r = await fileReport(db(), reporter.id, postId, category, "");
  if (!r.ok) throw new Error(r.code);
  return r.caseNo;
};
const state = (postId: string) => env.DB.prepare("select deleted_at from posts where id = ?").bind(postId).first<{ deleted_at: number | null }>();

describe("taking a reported post down", () => {
  it("hides the post for everyone, keeps the row, closes the case as 'Post removed', and tells the author and the reporter", async () => {
    const author = await person();
    const reporter = await person();
    const bystander = await person();
    const mod = await person({ moderator: true });
    const postId = await postOf(author);
    const caseNo = await report(reporter, postId);

    const res = await removePostFromCase(db(), asMod(mod), caseNo, "  clearly spam  ");
    expect(res).toEqual({ ok: true, closed: [caseNo] });

    // Soft delete, like the author's own Delete: the row stays and nobody can see the post.
    expect((await state(postId))?.deleted_at).not.toBeNull();
    for (const viewer of [author, reporter, bystander]) expect(await getPost(db(), viewer.id, postId)).toBeNull();

    const found = await getCase(db(), asMod(mod), caseNo);
    expect(found).toMatchObject({ status: "closed", outcome: "removed", resolutionNote: "clearly spam" });
    expect(found?.events.map((e) => [e.type, e.detail])).toEqual([["filed", "spam"], ["closed", "removed"]]);
    expect(found?.post.stillUp).toBe(false);

    // The reporter's own list and alert.
    expect((await listMyReports(db(), reporter.id))[0]).toMatchObject({ caseNo, status: "closed", outcome: "removed" });
    const reporterAlerts = (await listAlerts(db(), reporter.id)).items;
    expect(reporterAlerts).toHaveLength(1);
    expect(reporterAlerts[0]).toMatchObject({ type: "report_closed", unread: true, actors: [], post: null, report: { outcome: "Post removed" } });
    expect(reporterAlerts[0]!.report!.caseId).toMatch(/^CASE-\d{6}$/);
    expect(await countUnreadAlerts(db(), reporter.id)).toBe(1);
  });

  it("tells the author a post was removed and nothing else: no name, no reason, no report, and the alert still shows though the post is gone", async () => {
    const author = await person();
    const reporter = await person();
    const mod = await person({ moderator: true });
    const postId = await postOf(author, "something rude");
    const caseNo = await report(reporter, postId, "harassment");
    await removePostFromCase(db(), asMod(mod), caseNo, "");

    const alerts = (await listAlerts(db(), author.id)).items;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "post_removed", unread: true, actors: [], post: null, report: null, count: 1 });
    expect(JSON.stringify(alerts)).not.toContain(mod.username);
    expect(JSON.stringify(alerts)).not.toContain(reporter.username);
    expect(JSON.stringify(alerts)).not.toContain("something rude");
    expect(await countUnreadAlerts(db(), author.id)).toBe(1);
    // The author's alert has no case behind it.
    expect(await count("select count(*) as n from notifications where recipient_id = ? and report_id is not null", author.id)).toBe(0);
  });

  it("closes every open case about the post, for each reporter, and leaves cases on other posts alone", async () => {
    const author = await person();
    const [r1, r2, r3] = await Promise.all([person(), person(), person()]);
    const staff = await asAdmin();
    const postId = await postOf(author);
    const other = await postOf(author, "another one");
    const c1 = await report(r1, postId);
    const c2 = await report(r2, postId, "hate");
    const c3 = await report(r3, other);
    await closeCase(db(), staff, c2, "no_action", ""); // already closed: stays as it was

    const res = await removePostFromCase(db(), staff, c1, "");
    expect(res).toEqual({ ok: true, closed: [c1] });
    expect((await getCase(db(), staff, c2))).toMatchObject({ status: "closed", outcome: "no_action" });
    expect((await getCase(db(), staff, c3))).toMatchObject({ status: "open" });
    // r2 heard about its own closing earlier (one alert), not about the removal; r3 heard nothing.
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'report_closed'", r2.id)).toBe(1);
    expect(await count("select count(*) as n from notifications where recipient_id = ?", r3.id)).toBe(0);
    // And the author is told once.
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'post_removed'", author.id)).toBe(1);
  });

  it("closes the other open cases on the same post, with an alert for each reporter and one for the author", async () => {
    const author = await person();
    const [r1, r2] = await Promise.all([person(), person()]);
    const staff = await asAdmin();
    const postId = await postOf(author);
    const c1 = await report(r1, postId);
    const c2 = await report(r2, postId, "threat");
    const res = await removePostFromCase(db(), staff, c1, "");
    expect(res).toEqual({ ok: true, closed: [c1, c2] });
    for (const caseNo of [c1, c2]) expect(await getCase(db(), staff, caseNo)).toMatchObject({ status: "closed", outcome: "removed" });
    for (const r of [r1, r2]) expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'report_closed'", r.id)).toBe(1);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'post_removed'", author.id)).toBe(1);
  });

  it("does nothing the second time, however it is repeated", async () => {
    const author = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const postId = await postOf(author);
    const caseNo = await report(reporter, postId);
    const once = await removePostFromCase(db(), staff, caseNo, "");
    expect(once.ok).toBe(true);
    expect(await removePostFromCase(db(), staff, caseNo, "")).toEqual({ ok: false, code: "gone" });
    const both = await Promise.all([person(), person()]);
    expect(both).toHaveLength(2);
    expect(await count("select count(*) as n from report_events where report_id = (select id from reports where case_no = ?) and type = 'closed'", caseNo)).toBe(1);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'post_removed'", author.id)).toBe(1);
  });

  it("is safe when two staff press at once: one removal, one alert each", async () => {
    const author = await person();
    const reporter = await person();
    const modA = await person({ moderator: true });
    const modB = await person({ moderator: true });
    const postId = await postOf(author);
    const caseNo = await report(reporter, postId);
    const results = await Promise.all([removePostFromCase(db(), asMod(modA), caseNo, ""), removePostFromCase(db(), asMod(modB), caseNo, "")]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'post_removed'", author.id)).toBe(1);
    expect(await count("select count(*) as n from notifications where recipient_id = ? and type = 'report_closed'", reporter.id)).toBe(1);
    expect(await count("select count(*) as n from report_events where report_id = (select id from reports where case_no = ?) and type = 'closed'", caseNo)).toBe(1);
  });

  it("counts a parent's replies again when a reply is taken down", async () => {
    const author = await person();
    const replier = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const parent = await postOf(author, "the parent");
    const reply = await postOf(replier, "a rude reply", parent);
    expect((await getPost(db(), author.id, parent))?.replyCount).toBe(1);
    await removePostFromCase(db(), staff, await report(reporter, reply), "");
    expect((await getPost(db(), author.id, parent))?.replyCount).toBe(0);
  });

  it("keeps the post out of the feed and away from its author's profile", async () => {
    const author = await person();
    const fan = await person();
    const reporter = await person();
    const staff = await asAdmin();
    await env.DB.prepare("insert into follows (follower_id, followee_id) values (?, ?)").bind(fan.id, author.id).run();
    const postId = await postOf(author, "gone soon");
    expect((await listFeed(db(), fan.id, { scope: "following" })).items.map((p) => p.id)).toContain(postId);
    await removePostFromCase(db(), staff, await report(reporter, postId), "");
    expect((await listFeed(db(), fan.id, { scope: "following" })).items.map((p) => p.id)).not.toContain(postId);
  });

  it("never takes down the owner's posts, and only the admin takes down a moderator's", async () => {
    const admin = await theAdmin();
    const modAuthor = await person({ moderator: true });
    const modStaff = await person({ moderator: true });
    const reporter = await person();
    const adminPost = await postOf(admin, "the owner's post");
    const modPost = await postOf(modAuthor, "a moderator's post");
    const ownerCase = await report(reporter, adminPost);
    const modCase = await report(reporter, modPost);

    expect(await removePostFromCase(db(), asMod(modStaff), ownerCase, "")).toEqual({ ok: false, code: "owner" });
    expect(await removePostFromCase(db(), await asAdmin(), ownerCase, "")).toEqual({ ok: false, code: "owner" });
    expect(await removePostFromCase(db(), asMod(modStaff), modCase, "")).toEqual({ ok: false, code: "moderator" });
    expect((await state(adminPost))?.deleted_at).toBeNull();
    expect((await state(modPost))?.deleted_at).toBeNull();
    // The case page says so too.
    expect((await getCase(db(), asMod(modStaff), ownerCase))?.post.canRemove).toBe(false);
    expect((await getCase(db(), asMod(modStaff), modCase))?.post.canRemove).toBe(false);
    expect((await getCase(db(), await asAdmin(), modCase))?.post.canRemove).toBe(true);
    expect((await removePostFromCase(db(), await asAdmin(), modCase, "")).ok).toBe(true);
  });

  it("is a plain 'not found' for a case this moderator may not handle (their own post, or one they reported)", async () => {
    const mod = await person({ moderator: true });
    const other = await person();
    const own = await postOf(mod, "my own post");
    const ownCase = await report(other, own);
    const theirs = await postOf(other, "another's post");
    const reportedByMe = await report(mod, theirs);
    expect(await removePostFromCase(db(), asMod(mod), ownCase, "")).toEqual({ ok: false, code: "not_found" });
    expect(await removePostFromCase(db(), asMod(mod), reportedByMe, "")).toEqual({ ok: false, code: "not_found" });
    expect(await removePostFromCase(db(), asMod(mod), 999999, "")).toEqual({ ok: false, code: "not_found" });
    expect(await removePostFromCase(db(), asMod(mod), "nonsense", "")).toEqual({ ok: false, code: "not_found" });
    expect((await state(own))?.deleted_at).toBeNull();
  });

  it("refuses a note that is too long or has odd characters, and a post the author already deleted", async () => {
    const author = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const postId = await postOf(author);
    const caseNo = await report(reporter, postId);
    expect(await removePostFromCase(db(), staff, caseNo, "x".repeat(501))).toEqual({ ok: false, code: "note_too_long" });
    expect(await removePostFromCase(db(), staff, caseNo, "bad\u0000note")).toEqual({ ok: false, code: "bad_note" });
    await env.DB.prepare("update posts set deleted_at = ? where id = ?").bind(Date.now(), postId).run();
    expect(await removePostFromCase(db(), staff, caseNo, "")).toEqual({ ok: false, code: "gone" });
  });
});

describe("telling the reporter when a case closes", () => {
  it("alerts the reporter once when a case is closed, whatever the outcome, and names nobody", async () => {
    const author = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const caseNo = await report(reporter, await postOf(author));
    expect(await closeCase(db(), staff, caseNo, "handled", "")).toMatchObject({ ok: true, changed: true });
    // Pressing it again changes nothing and alerts nothing.
    expect(await closeCase(db(), staff, caseNo, "handled", "")).toMatchObject({ ok: true, changed: false });
    const alerts = (await listAlerts(db(), reporter.id)).items;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "report_closed", actors: [], report: { outcome: "Handled" } });
  });

  it("alerts again, as a new unread one, when a case is opened again and closed again", async () => {
    const author = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const caseNo = await report(reporter, await postOf(author));
    await closeCase(db(), staff, caseNo, "no_action", "");
    await listAlerts(db(), reporter.id);
    await env.DB.prepare("update notifications set read_at = ? where recipient_id = ?").bind(Date.now(), reporter.id).run();
    expect(await countUnreadAlerts(db(), reporter.id)).toBe(0);
    await reopenCase(db(), staff, caseNo);
    await closeCase(db(), staff, caseNo, "handled", "");
    const alerts = (await listAlerts(db(), reporter.id)).items;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ unread: true, report: { outcome: "Handled" } });
  });

  it("does not alert the author, or anyone else, about a closed case", async () => {
    const author = await person();
    const reporter = await person();
    const staff = await asAdmin();
    const caseNo = await report(reporter, await postOf(author));
    await closeCase(db(), staff, caseNo, "handled", "");
    expect((await listAlerts(db(), author.id)).items).toHaveLength(0);
  });
});

describe("suspending a member", () => {
  it("signs them out everywhere, hides them from everyone, and lifts back to how it was", async () => {
    const target = await person();
    const fan = await person();
    const staff = await asAdmin();
    await env.DB.prepare("insert into follows (follower_id, followee_id) values (?, ?)").bind(fan.id, target.id).run();
    const postId = await postOf(target, "visible before");
    for (let i = 0; i < 2; i++)
      await db().insert(session).values({ id: newId("session"), token: `tok-${n}-${i}`, userId: target.id, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: new Date() });
    expect(await count("select count(*) as n from session where user_id = ?", target.id)).toBe(2);
    expect(await getProfile(db(), fan.id, target.username)).not.toBeNull();

    expect(await suspendMember(db(), staff, target.id, "  repeated abuse ")).toEqual({ ok: true, changed: true });

    expect(await count("select count(*) as n from session where user_id = ?", target.id)).toBe(0);
    const row = await env.DB.prepare("select status, suspended_at, suspended_by, suspension_note from profiles where user_id = ?").bind(target.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "suspended", suspended_by: staff.userId, suspension_note: "repeated abuse" });
    expect(row?.suspended_at).toBeTruthy();
    // Gone from every screen but staff's.
    expect(await getPost(db(), fan.id, postId)).toBeNull();
    expect((await listFeed(db(), fan.id, { scope: "following" })).items.map((p) => p.id)).not.toContain(postId);
    expect(await getProfile(db(), fan.id, target.username)).toBeNull();
    expect((await searchPeople(db(), fan.id, target.username)).map((p) => p.userId)).not.toContain(target.id);

    // Staff still see them, with the status.
    const listed = await listMembers(db(), { isAdmin: true }, { filter: "suspended" });
    expect(listed.items.map((m) => [m.userId, m.status])).toContainEqual([target.id, "suspended"]);

    expect(await liftSuspension(db(), staff, target.id)).toEqual({ ok: true, changed: true });
    expect(await getPost(db(), fan.id, postId)).not.toBeNull();
    expect(await getProfile(db(), fan.id, target.username)).not.toBeNull();
    const after = await env.DB.prepare("select status, suspended_at, suspended_by, suspension_note from profiles where user_id = ?").bind(target.id).first<Record<string, unknown>>();
    expect(after).toEqual({ status: "active", suspended_at: null, suspended_by: null, suspension_note: "" });
  });

  it("is the same when repeated, in either direction", async () => {
    const target = await person();
    const staff = await asAdmin();
    expect(await liftSuspension(db(), staff, target.id)).toEqual({ ok: true, changed: false });
    expect(await suspendMember(db(), staff, target.id, "")).toEqual({ ok: true, changed: true });
    expect(await suspendMember(db(), staff, target.id, "")).toEqual({ ok: true, changed: false });
    const results = await Promise.all([liftSuspension(db(), staff, target.id), liftSuspension(db(), staff, target.id)]);
    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
  });

  it("lets a moderator suspend an ordinary member, and nobody suspend the owner, themselves or a person who is still waiting", async () => {
    const admin = await theAdmin();
    const mod = await person({ moderator: true });
    const member = await person();
    const waiting = await person({ status: "pending" });
    expect(await suspendMember(db(), asMod(mod), member.id, "")).toEqual({ ok: true, changed: true });
    expect(await suspendMember(db(), asMod(mod), admin.id, "")).toEqual({ ok: false, code: "owner" });
    expect(await suspendMember(db(), await asAdmin(), admin.id, "")).toEqual({ ok: false, code: "owner" });
    expect(await suspendMember(db(), asMod(mod), mod.id, "")).toEqual({ ok: false, code: "self" });
    expect(await suspendMember(db(), await asAdmin(), waiting.id, "")).toEqual({ ok: false, code: "not_active" });
    expect(await suspendMember(db(), await asAdmin(), "nope", "")).toEqual({ ok: false, code: "not_found" });
    expect(await suspendMember(db(), await asAdmin(), newId("user"), "")).toEqual({ ok: false, code: "not_found" });
  });

  it("keeps a moderator's account for the admin to suspend: another moderator cannot", async () => {
    const modA = await person({ moderator: true });
    const modB = await person({ moderator: true });
    expect(await suspendMember(db(), asMod(modA), modB.id, "")).toEqual({ ok: false, code: "moderator" });
    expect(await suspendMember(db(), await asAdmin(), modB.id, "")).toEqual({ ok: true, changed: true });
    // Lifting follows the same rule.
    expect(await liftSuspension(db(), asMod(modA), modB.id)).toEqual({ ok: false, code: "moderator" });
    expect(await liftSuspension(db(), await asAdmin(), modB.id)).toEqual({ ok: true, changed: true });
  });

  it("refuses a note that is too long or has odd characters, and changes nothing", async () => {
    const target = await person();
    const staff = await asAdmin();
    expect(await suspendMember(db(), staff, target.id, "x".repeat(501))).toEqual({ ok: false, code: "note_too_long" });
    expect(await suspendMember(db(), staff, target.id, "a\u0007b")).toEqual({ ok: false, code: "bad_note" });
    expect((await env.DB.prepare("select status from profiles where user_id = ?").bind(target.id).first<{ status: string }>())?.status).toBe("active");
  });

  it("cannot be suspended into a state the database refuses", async () => {
    const target = await person();
    await expect(env.DB.prepare("update profiles set status = 'suspended' where user_id = ?").bind(target.id).run()).rejects.toThrow();
    await expect(env.DB.prepare("update profiles set suspended_at = 5 where user_id = ?").bind(target.id).run()).rejects.toThrow();
  });
});

describe("signing in while suspended", () => {
  const fakeAuth = (userId: string, token: string) => ({ api: { signInEmail: async () => ({ user: { id: userId }, token }) } }) as unknown as Pick<Auth, "api">;

  it("tells a suspended person so, after the password was right, and removes the session it just made", async () => {
    const target = await person();
    await suspendMember(db(), await asAdmin(), target.id, "");
    const token = `signin-${target.id}`;
    await db().insert(session).values({ id: newId("session"), token, userId: target.id, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: new Date() });
    const res = await signInMember(fakeAuth(target.id, token), db(), { email: "x@example.com", password: "whatever" });
    expect(res).toMatchObject({ ok: false, code: "suspended" });
    expect(res.ok ? "" : res.message).toMatch(/suspended/i);
    expect(await count("select count(*) as n from session where token = ?", token)).toBe(0);
  });

  it("still gives a pending person the waiting message and an active one a session", async () => {
    const waiting = await person({ status: "pending" });
    const active = await person();
    expect(await signInMember(fakeAuth(waiting.id, "t1"), db(), { email: "x@example.com", password: "p" })).toMatchObject({ ok: false, code: "pending" });
    expect(await signInMember(fakeAuth(active.id, "t2"), db(), { email: "x@example.com", password: "p" })).toEqual({ ok: true, userId: active.id });
  });
});
