import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createPost, deletePost } from "@/server/posts";
import { setBlock, setPrivate } from "@/server/privacy";
import { LIMITS, limitReport } from "@/server/rate-limit";
import { closeCase, countOpenCases, fileReport, getCase, listCases, listMyReports, reopenCase, startReview } from "@/server/reports";

const db = () => getDb(env.DB);
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

let n = 0;
async function person(over: { role?: "admin" | "member"; moderator?: boolean; first?: string } = {}) {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `rp${i}@example.com` });
  await db()
    .insert(profiles)
    .values({ userId: id, username: `rep_${i}`, firstName: over.first ?? `First${i}`, lastName: `Last${i}`, role: over.role ?? "member", isModerator: over.moderator ?? false });
  return { id, username: `rep_${i}` };
}

// The database allows exactly one admin, so every test shares this one.
let sharedAdmin: Awaited<ReturnType<typeof person>> | null = null;
const theAdmin = async () => (sharedAdmin ??= await person({ role: "admin", first: "Boss" }));
const asAdmin = async () => ({ userId: (await theAdmin()).id, isAdmin: true });
const asMod = (p: { id: string }) => ({ userId: p.id, isAdmin: false });

const postOf = async (author: { id: string }, text = "a post worth a look") => ((await createPost(db(), author.id, text)) as { id: string }).id;

describe("filing a report", () => {
  it("makes a case with a number and keeps a copy of the post", async () => {
    const author = await person();
    const reporter = await person();
    const postId = await postOf(author, "spammy words here");

    const result = await fileReport(db(), reporter.id, postId, "spam", "  looks like an advert  ");
    expect(result).toMatchObject({ ok: true, already: false });
    if (!result.ok) return;
    expect(result.caseId).toMatch(/^CASE-\d{6}$/);

    const staff = await asAdmin();
    const found = await getCase(db(), staff, result.caseNo);
    expect(found).toMatchObject({
      caseId: result.caseId,
      status: "open",
      category: "spam",
      note: "looks like an advert",
      post: { body: "spammy words here", authorUsername: author.username, stillUp: true, isReply: false },
      reporter: { username: reporter.username },
    });
    expect(found?.events.map((e) => e.type)).toEqual(["filed"]);

    // The copy survives the author deleting the post.
    await deletePost(db(), author.id, postId);
    const later = await getCase(db(), staff, result.caseNo);
    expect(later?.post.body).toBe("spammy words here");
    expect(later?.post.stillUp).toBe(false);
  });

  it("numbers cases one after another, even when filed at the same moment", async () => {
    const author = await person();
    const people = await Promise.all(Array.from({ length: 6 }, () => person()));
    const postId = await postOf(author);
    const results = await Promise.all(people.map((p) => fileReport(db(), p.id, postId, "spam", "")));
    const numbers = results.map((r) => (r.ok ? r.caseNo : -1));
    expect(numbers.every((x) => x > 0)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives the same case back when the same person reports the same post again", async () => {
    const author = await person();
    const reporter = await person();
    const postId = await postOf(author);
    const first = await fileReport(db(), reporter.id, postId, "spam", "");
    const again = await fileReport(db(), reporter.id, postId, "hate", "changed my mind");
    expect(first.ok && again.ok && again.caseNo === first.caseNo && again.already).toBe(true);
    if (first.ok) expect(await count("select count(*) as n from reports where reporter_id = ? and post_id = ?", reporter.id, postId)).toBe(1);

    // Two taps at the same moment still make one case.
    const other = await person();
    const [a, b] = await Promise.all([fileReport(db(), other.id, postId, "spam", ""), fileReport(db(), other.id, postId, "spam", "")]);
    expect(a.ok && b.ok && a.caseNo === b.caseNo).toBe(true);
    expect(await count("select count(*) as n from reports where reporter_id = ? and post_id = ?", other.id, postId)).toBe(1);
  });

  it("refuses your own post, a post you cannot see, and bad input", async () => {
    const author = await person();
    const reporter = await person();
    const postId = await postOf(author);
    expect(await fileReport(db(), author.id, postId, "spam", "")).toEqual({ ok: false, code: "own_post" });
    expect(await fileReport(db(), reporter.id, "post_000000000000000000000000", "spam", "")).toEqual({ ok: false, code: "not_found" });
    expect(await fileReport(db(), reporter.id, 42, "spam", "")).toEqual({ ok: false, code: "not_found" });
    expect(await fileReport(db(), reporter.id, postId, "nonsense", "")).toEqual({ ok: false, code: "bad_category" });
    expect(await fileReport(db(), reporter.id, postId, "other", "   ")).toEqual({ ok: false, code: "note_required" });
    expect(await fileReport(db(), reporter.id, postId, "spam", "x".repeat(501))).toEqual({ ok: false, code: "note_too_long" });
    expect(await fileReport(db(), reporter.id, postId, "spam", "bad\u0000text")).toEqual({ ok: false, code: "bad_note" });
    expect(await fileReport(db(), reporter.id, postId, "other", "x".repeat(500))).toMatchObject({ ok: true });

    // A private account's post, and a post by someone who blocked you, cannot be reported by a stranger.
    const hidden = await person();
    const hiddenPost = await postOf(hidden);
    await setPrivate(db(), hidden.id, true);
    expect(await fileReport(db(), reporter.id, hiddenPost, "spam", "")).toEqual({ ok: false, code: "not_found" });
    const blocker = await person();
    const blockedPost = await postOf(blocker);
    await setBlock(db(), blocker.id, reporter.id, true);
    expect(await fileReport(db(), reporter.id, blockedPost, "spam", "")).toEqual({ ok: false, code: "not_found" });
  });

  it("is limited to ten an hour per person", async () => {
    const who = await person();
    const results = [];
    for (let i = 0; i < LIMITS.reports.max + 1; i++) results.push(await limitReport(env.DB, "test-salt", who.id));
    expect(results.filter((r) => r.ok)).toHaveLength(LIMITS.reports.max);
    expect(results[results.length - 1]?.ok).toBe(false);
  });
});

describe("working a case", () => {
  async function fresh() {
    const author = await person();
    const reporter = await person();
    const postId = await postOf(author);
    const r = await fileReport(db(), reporter.id, postId, "harassment", "rude to me");
    if (!r.ok) throw new Error("could not file");
    return { author, reporter, postId, caseNo: r.caseNo };
  }

  it("moves open to in review to closed and back, with an event each time", async () => {
    const { caseNo } = await fresh();
    const staff = await asAdmin();

    expect(await startReview(db(), staff, caseNo)).toEqual({ ok: true, status: "reviewing", changed: true });
    expect(await startReview(db(), staff, caseNo)).toEqual({ ok: true, status: "reviewing", changed: false });
    expect(await closeCase(db(), staff, caseNo, "handled", "spoke to them")).toEqual({ ok: true, status: "closed", changed: true });
    expect(await closeCase(db(), staff, caseNo, "no_action", "")).toEqual({ ok: true, status: "closed", changed: false });

    const closed = await getCase(db(), staff, caseNo);
    expect(closed).toMatchObject({ status: "closed", outcome: "handled", resolutionNote: "spoke to them", handledByName: expect.stringMatching(/^Boss /) });
    expect(closed?.closedAt).not.toBeNull();

    expect(await reopenCase(db(), staff, caseNo)).toEqual({ ok: true, status: "open", changed: true });
    const reopened = await getCase(db(), staff, caseNo);
    expect(reopened).toMatchObject({ status: "open", outcome: null, closedAt: null });
    expect(reopened?.events.map((e) => e.type)).toEqual(["filed", "review_started", "closed", "reopened"]);
  });

  it("can be closed straight from open, and refuses a bad outcome or a long note", async () => {
    const { caseNo } = await fresh();
    const staff = await asAdmin();
    expect(await closeCase(db(), staff, caseNo, "removed", "")).toEqual({ ok: false, code: "bad_outcome" });
    expect(await closeCase(db(), staff, caseNo, "handled", "x".repeat(501))).toEqual({ ok: false, code: "note_too_long" });
    expect(await closeCase(db(), staff, caseNo, "duplicate", "")).toMatchObject({ ok: true, status: "closed" });
  });

  it("lets a person report the post again once the earlier case is closed", async () => {
    const { reporter, postId, caseNo } = await fresh();
    await closeCase(db(), await asAdmin(), caseNo, "no_action", "");
    const second = await fileReport(db(), reporter.id, postId, "hate", "");
    expect(second).toMatchObject({ ok: true, already: false });
    if (second.ok) expect(second.caseNo).toBeGreaterThan(caseNo);
  });

  it("two staff pressing at once make one change and one event", async () => {
    const { caseNo } = await fresh();
    const staff = await asAdmin();
    const mod = await person({ moderator: true });
    await Promise.all([startReview(db(), staff, caseNo), startReview(db(), asMod(mod), caseNo)]);
    const found = await getCase(db(), staff, caseNo);
    expect(found?.events.filter((e) => e.type === "review_started")).toHaveLength(1);
  });

  it("does not show a moderator a case about their own post or one they reported", async () => {
    const mod = await person({ moderator: true });
    const other = await person();
    const admin = await asAdmin();

    const aboutMod = await fileReport(db(), other.id, await postOf(mod), "spam", "");
    const byMod = await fileReport(db(), mod.id, await postOf(other), "spam", "");
    const plain = await fileReport(db(), other.id, await postOf(await person()), "spam", "");
    if (!aboutMod.ok || !byMod.ok || !plain.ok) throw new Error("could not file");

    for (const hidden of [aboutMod.caseNo, byMod.caseNo]) {
      expect(await getCase(db(), asMod(mod), hidden)).toBeNull();
      expect(await startReview(db(), asMod(mod), hidden)).toEqual({ ok: false, code: "not_found" });
      expect(await closeCase(db(), asMod(mod), hidden, "handled", "")).toEqual({ ok: false, code: "not_found" });
      // The owner sees both.
      expect(await getCase(db(), admin, hidden)).not.toBeNull();
    }
    expect(await getCase(db(), asMod(mod), plain.caseNo)).not.toBeNull();

    const listed = (await listCases(db(), asMod(mod), { limit: 100 })).items.map((c) => c.caseNo);
    expect(listed).toContain(plain.caseNo);
    expect(listed).not.toContain(aboutMod.caseNo);
    expect(listed).not.toContain(byMod.caseNo);
  });

  it("lists by state, finds a case by its number, pages, and counts the open ones", async () => {
    const staff = await asAdmin();
    const author = await person({ first: "Zelda" });
    const reporters = await Promise.all([person(), person(), person()]);
    const postId = await postOf(author, "findable needle in the text");
    const made = [];
    for (const r of reporters) {
      const x = await fileReport(db(), r.id, postId, "spam", "");
      if (x.ok) made.push(x.caseNo);
    }
    const [one, two, three] = made as [number, number, number];
    await startReview(db(), staff, two);
    await closeCase(db(), staff, three, "no_action", "");

    const open = (await listCases(db(), staff, { filter: "open", limit: 100 })).items.map((c) => c.caseNo);
    expect(open).toContain(one);
    expect(open).not.toContain(two);
    expect((await listCases(db(), staff, { filter: "reviewing", limit: 100 })).items.map((c) => c.caseNo)).toContain(two);
    expect((await listCases(db(), staff, { filter: "closed", limit: 100 })).items.map((c) => c.caseNo)).toContain(three);

    // A number finds the case in any state, in any spelling people use.
    for (const text of [`CASE-${String(three).padStart(6, "0")}`, `case ${three}`, String(three)]) {
      expect((await listCases(db(), staff, { query: text })).items.map((c) => c.caseNo)).toEqual([three]);
    }
    // Words from the post find it too, and a % in the search is only a %.
    expect((await listCases(db(), staff, { filter: "open", query: "needle in the" })).items.map((c) => c.caseNo)).toContain(one);
    expect((await listCases(db(), staff, { filter: "open", query: "%" })).items).toHaveLength(0);

    // Paging walks down the numbers without repeating any.
    const first = await listCases(db(), staff, { filter: "open", limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCases(db(), staff, { filter: "open", limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.caseNo).toBeLessThan(first.items[0]!.caseNo);
    expect(await listCases(db(), staff, { cursor: "not a cursor" })).toBeTruthy();

    expect(await countOpenCases(db(), staff)).toBe(await count("select count(*) as n from reports where status = 'open'"));

    // The other cases on the same post are listed on each case.
    const detail = await getCase(db(), staff, one);
    expect(detail?.others.map((o) => o.caseNo).sort()).toEqual([two, three].sort());
  });

  it("shows a reporter their own reports and nobody else's", async () => {
    const { reporter, caseNo } = await fresh();
    const stranger = await person();
    expect((await listMyReports(db(), stranger.id)).map((r) => r.caseNo)).not.toContain(caseNo);
    const mine = await listMyReports(db(), reporter.id);
    expect(mine[0]).toMatchObject({ caseNo, status: "open", categoryLabel: "Bullying or harassment" });
    expect(Object.keys(mine[0]!)).not.toContain("note");
  });
});

describe("the reports tables", () => {
  it("refuse impossible rows", async () => {
    const author = await person();
    const reporter = await person();
    const postId = await postOf(author);
    const id = newId("report");
    const insert = (over: { category?: string; status?: string; outcome?: string | null; closedAt?: number | null; caseNo?: number } = {}) =>
      env.DB.prepare(
        `insert into reports (id, case_no, post_id, post_author_username, post_body, post_created_at, reporter_id, category, status, outcome, closed_at)
         values (?, ?, ?, 'a', 'b', 1, ?, ?, ?, ?, ?)`,
      ).bind(over.caseNo === undefined ? newId("report") : id, over.caseNo ?? 900_000 + n++, postId, reporter.id, over.category ?? "spam", over.status ?? "open", over.outcome ?? null, over.closedAt ?? null).run();

    await expect(insert({ category: "bogus" })).rejects.toThrow();
    await expect(insert({ status: "closed" })).rejects.toThrow(); // closed needs an outcome and a time
    await expect(insert({ status: "open", outcome: "handled", closedAt: 5 })).rejects.toThrow(); // open must have neither
    await expect(insert({ status: "closed", outcome: "bogus", closedAt: 5 })).rejects.toThrow();
    await expect(insert({ caseNo: 0 })).rejects.toThrow();
    await insert({ status: "closed", outcome: "removed", closedAt: 5 }); // allowed by the database for the removal tools to come
  });
});
