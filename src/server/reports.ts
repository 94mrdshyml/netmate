// Reporting a post (docs/PRD.md, "Reporting a post"). A member reports a post they can see; that makes one
// case with a number (CASE-000123). Staff (the admin and the moderators) work the case: take it, close it with an
// outcome, open it again. Pages and actions call these; they never write SQL.
//
// What stays private: the person who wrote the post is never told, and no query here returns who reported
// to anyone but staff. A moderator never sees a case about their own post or one they reported themselves.
// The case keeps its own copy of the post as it was reported (the one place a post is shown to staff without
// `visibleTo`, because the reporter chose to share exactly this).

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { reportEvents, reports, type ReportStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import {
  categoryLabel,
  checkReportNote,
  formatCaseId,
  isReportCategory,
  isReportOutcome,
  parseCaseId,
  type ReportCategory,
  type ReportOutcome,
} from "@/lib/report-categories";
import { decodeCaseCursor, likePatternOf } from "@/lib/report-list";
import { getPost } from "@/server/posts";

export const CASE_PAGE = 25;
export const CASE_FILTERS = ["open", "reviewing", "closed"] as const;
export type CaseFilter = (typeof CASE_FILTERS)[number];

// ---- filing ----

export type FileReportResult =
  | { ok: true; caseNo: number; caseId: string; already: boolean }
  | { ok: false; code: "not_found" | "own_post" | "bad_category" | "note_required" | "note_too_long" | "bad_note" };

/**
 * Reports a post. The reporter must be able to see it (the `visibleTo` rule, through `getPost`) and it cannot be
 * their own. Reporting a post you already have a live case on gives you that same case back, so tapping twice, or
 * two phones at once, makes one case. The case and its first event are written in one batch.
 */
export async function fileReport(db: Db, reporterId: string, postId: unknown, category: unknown, note: unknown): Promise<FileReportResult> {
  if (typeof postId !== "string") return { ok: false, code: "not_found" };
  const post = await getPost(db, reporterId, postId);
  if (!post) return { ok: false, code: "not_found" };
  if (post.author.userId === reporterId) return { ok: false, code: "own_post" };
  if (!isReportCategory(category)) return { ok: false, code: "bad_category" };
  const checked = checkReportNote(note, category === "other");
  if (!checked.ok) return { ok: false, code: checked.reason === "required" ? "note_required" : checked.reason === "too_long" ? "note_too_long" : "bad_note" };

  const live = async () =>
    db
      .select({ caseNo: reports.caseNo })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), eq(reports.postId, post.id), sql`${reports.status} <> 'closed'`))
      .get();

  const before = await live();
  if (before) return { ok: true, caseNo: before.caseNo, caseId: formatCaseId(before.caseNo), already: true };

  // The number is "one more than the highest" worked out inside the insert itself, so two reports at the same
  // moment cannot get the same number. The unique index would refuse a clash anyway; then we simply try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId("report");
    try {
      await db.batch([
        db.insert(reports).values({
          id,
          caseNo: sql`(select coalesce(max(case_no), 0) + 1 from reports)`,
          postId: post.id,
          postAuthorId: post.author.userId,
          postAuthorUsername: post.author.username,
          postBody: post.body,
          postPhotos: post.photos.length,
          postHasGif: post.gif !== null,
          postHasLink: post.link !== null,
          postIsReply: post.parentId !== null,
          postCreatedAt: new Date(post.createdAt),
          reporterId,
          category,
          note: checked.text,
        }),
        db.insert(reportEvents).values({ id: newId("reportEvent"), reportId: id, actorId: reporterId, type: "filed", detail: category }),
      ]);
    } catch {
      // Either the same person filed it a moment ago (their live case is the answer), or the number clashed.
      const again = await live();
      if (again) return { ok: true, caseNo: again.caseNo, caseId: formatCaseId(again.caseNo), already: true };
      continue;
    }
    const made = await db.select({ caseNo: reports.caseNo }).from(reports).where(eq(reports.id, id)).get();
    if (made) return { ok: true, caseNo: made.caseNo, caseId: formatCaseId(made.caseNo), already: false };
  }
  return { ok: false, code: "not_found" };
}

// ---- what the reporter sees ----

export type MyReport = { caseNo: number; caseId: string; category: ReportCategory; categoryLabel: string; status: ReportStatus; outcome: string | null; createdAt: number; excerpt: string };

const excerptOf = (body: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > 90 ? `${chars.slice(0, 90).join("")}...` : flat;
};

/** The reports you made, newest first. Only the case number, the kind, the post's first words and where it stands. */
export async function listMyReports(db: Db, reporterId: string, limit = 50): Promise<MyReport[]> {
  const rows = await db
    .select({
      caseNo: reports.caseNo,
      category: reports.category,
      status: reports.status,
      outcome: reports.outcome,
      createdAt: reports.createdAt,
      body: reports.postBody,
    })
    .from(reports)
    .where(eq(reports.reporterId, reporterId))
    .orderBy(sql`${reports.caseNo} desc`)
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    caseNo: r.caseNo,
    caseId: formatCaseId(r.caseNo),
    category: r.category as ReportCategory,
    categoryLabel: categoryLabel(r.category),
    status: r.status as ReportStatus,
    outcome: r.outcome,
    createdAt: r.createdAt.getTime(),
    excerpt: excerptOf(r.body),
  }));
}

// ---- what staff see ----

export type Staff = { userId: string; isAdmin: boolean };

/**
 * Which cases this person may see. The admin sees all. A moderator never sees one about their own post or one
 * they reported themselves, so nobody judges their own case.
 */
const mayHandle = (staff: Staff) =>
  staff.isAdmin ? sql`1 = 1` : sql`(r.reporter_id is null or r.reporter_id <> ${staff.userId}) and (r.post_author_id is null or r.post_author_id <> ${staff.userId})`;

export type CaseSummary = {
  caseNo: number;
  caseId: string;
  status: ReportStatus;
  category: ReportCategory;
  categoryLabel: string;
  outcome: string | null;
  createdAt: number;
  excerpt: string;
  authorUsername: string;
  reporterName: string | null;
  handledByName: string | null;
};

type SummaryRow = {
  caseNo: number;
  status: string;
  category: string;
  outcome: string | null;
  createdAt: number;
  body: string;
  authorUsername: string;
  reporterName: string | null;
  handledByName: string | null;
};

const toSummary = (r: SummaryRow): CaseSummary => ({
  caseNo: r.caseNo,
  caseId: formatCaseId(r.caseNo),
  status: r.status as ReportStatus,
  category: r.category as ReportCategory,
  categoryLabel: categoryLabel(r.category),
  outcome: r.outcome,
  createdAt: r.createdAt,
  excerpt: excerptOf(r.body),
  authorUsername: r.authorUsername,
  reporterName: r.reporterName,
  handledByName: r.handledByName,
});

export type CasePage = { items: CaseSummary[]; nextCursor: string | null };

/** One page of cases, newest first. `query` is a case number ("CASE-000123", "123") or words from the post or its author. */
export async function listCases(db: Db, staff: Staff, opts: { filter?: unknown; query?: unknown; cursor?: unknown; limit?: number } = {}): Promise<CasePage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? CASE_PAGE), 1), 100);
  const filter: CaseFilter = (CASE_FILTERS as readonly unknown[]).includes(opts.filter) ? (opts.filter as CaseFilter) : "open";
  const text = typeof opts.query === "string" ? opts.query.trim() : "";
  const cursor = decodeCaseCursor(opts.cursor);

  const byNumber = text === "" ? null : parseCaseId(text);
  const pattern = likePatternOf(text);
  const search =
    text === ""
      ? sql``
      : byNumber !== null
        ? sql`and r.case_no = ${byNumber}`
        : sql`and (lower(r.post_body) like ${pattern} escape '\\' or lower(r.post_author_username) like ${pattern} escape '\\')`;
  // A search for a number looks in every state; the tabs only narrow a plain list.
  const narrow = byNumber !== null ? sql`` : sql`and r.status = ${filter}`;
  const after = cursor !== null ? sql`and r.case_no < ${cursor}` : sql``;

  const rows = await db.all<SummaryRow>(sql`
    select r.case_no as caseNo, r.status as status, r.category as category, r.outcome as outcome,
           r.created_at as createdAt, r.post_body as body, r.post_author_username as authorUsername,
           (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = r.reporter_id) as reporterName,
           (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = r.handled_by) as handledByName
    from reports r
    where ${mayHandle(staff)} ${narrow} ${search} ${after}
    order by r.case_no desc
    limit ${limit + 1}`);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map(toSummary), nextCursor: rows.length > limit && last ? String(last.caseNo) : null };
}

/** How many cases are waiting for someone to take them, for the badge in the menu. */
export async function countOpenCases(db: Db, staff: Staff): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`select count(*) as n from reports r where r.status = 'open' and ${mayHandle(staff)}`);
  return row?.n ?? 0;
}

export type CaseEvent = { type: "filed" | "review_started" | "closed" | "reopened"; at: number; actorName: string | null; detail: string };

export type CaseDetail = CaseSummary & {
  note: string;
  resolutionNote: string;
  closedAt: number | null;
  updatedAt: number;
  post: { body: string; photos: number; hasGif: boolean; hasLink: boolean; isReply: boolean; createdAt: number; authorUsername: string; authorName: string | null; stillUp: boolean };
  reporter: { username: string; name: string } | null;
  /** Other cases about the same post: the number and where each stands. */
  others: { caseNo: number; caseId: string; status: ReportStatus; categoryLabel: string }[];
  events: CaseEvent[];
};

/** One case with everything staff need, or null when it does not exist or this person may not handle it. */
export async function getCase(db: Db, staff: Staff, caseNo: unknown): Promise<CaseDetail | null> {
  const n = typeof caseNo === "number" ? (Number.isSafeInteger(caseNo) && caseNo >= 1 ? caseNo : null) : parseCaseId(caseNo);
  if (n === null) return null;

  const [row] = await db.all<
    SummaryRow & {
      id: string;
      postId: string | null;
      note: string;
      resolutionNote: string;
      closedAt: number | null;
      updatedAt: number;
      photos: number;
      hasGif: number;
      hasLink: number;
      isReply: number;
      postCreatedAt: number;
      authorName: string | null;
      stillUp: number;
      reporterUsername: string | null;
    }
  >(sql`
    select r.id as id, r.case_no as caseNo, r.post_id as postId, r.status as status, r.category as category, r.outcome as outcome,
           r.created_at as createdAt, r.updated_at as updatedAt, r.closed_at as closedAt,
           r.post_body as body, r.post_author_username as authorUsername,
           r.note as note, r.resolution_note as resolutionNote,
           r.post_photos as photos, r.post_has_gif as hasGif, r.post_has_link as hasLink, r.post_is_reply as isReply, r.post_created_at as postCreatedAt,
           (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = r.post_author_id) as authorName,
           (select count(*) from posts x where x.id = r.post_id and x.deleted_at is null) as stillUp,
           (select p.username from profiles p where p.user_id = r.reporter_id) as reporterUsername,
           (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = r.reporter_id) as reporterName,
           (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = r.handled_by) as handledByName
    from reports r
    where r.case_no = ${n} and ${mayHandle(staff)}`);
  if (!row) return null;

  const [others, events] = await Promise.all([
    row.postId
      ? db.all<{ caseNo: number; status: string; category: string }>(
          sql`select r.case_no as caseNo, r.status as status, r.category as category from reports r
              where r.post_id = ${row.postId} and r.case_no <> ${n} and ${mayHandle(staff)}
              order by r.case_no desc limit 10`,
        )
      : Promise.resolve([]),
    db.all<{ type: string; at: number; actorName: string | null; detail: string }>(
      sql`select e.type as type, e.created_at as at, e.detail as detail,
                 (select p.first_name || ' ' || p.last_name from profiles p where p.user_id = e.actor_id) as actorName
          from report_events e where e.report_id = ${row.id} order by e.created_at asc, e.id asc`,
    ),
  ]);

  return {
    ...toSummary(row),
    note: row.note,
    resolutionNote: row.resolutionNote,
    closedAt: row.closedAt,
    updatedAt: row.updatedAt,
    post: {
      body: row.body,
      photos: row.photos,
      hasGif: row.hasGif === 1,
      hasLink: row.hasLink === 1,
      isReply: row.isReply === 1,
      createdAt: row.postCreatedAt,
      authorUsername: row.authorUsername,
      authorName: row.authorName,
      stillUp: row.stillUp > 0,
    },
    reporter: row.reporterName && row.reporterUsername ? { username: row.reporterUsername, name: row.reporterName } : null,
    others: others.map((o) => ({ caseNo: o.caseNo, caseId: formatCaseId(o.caseNo), status: o.status as ReportStatus, categoryLabel: categoryLabel(o.category) })),
    events: events.map((e) => ({ type: e.type as CaseEvent["type"], at: e.at, actorName: e.actorName, detail: e.detail })),
  };
}

// ---- working a case ----

export type CaseChange = { ok: true; status: ReportStatus; changed: boolean } | { ok: false; code: "not_found" | "bad_outcome" | "note_too_long" | "bad_note" };

/**
 * Moves a case to the state wanted. Sending the same state twice changes nothing the second time (and adds no
 * event). Each move is one conditional update plus its event in one batch, so two staff pressing at once cannot
 * both win. A case this person may not handle is "not found".
 */
async function move(
  db: Db,
  staff: Staff,
  caseNo: unknown,
  wanted: { status: "reviewing" } | { status: "open" } | { status: "closed"; outcome: ReportOutcome; note: string },
): Promise<CaseChange> {
  const n = typeof caseNo === "number" ? caseNo : parseCaseId(caseNo);
  if (n === null || !Number.isSafeInteger(n) || n < 1) return { ok: false, code: "not_found" };
  const mine = await db.all<{ id: string; status: string }>(sql`select r.id as id, r.status as status from reports r where r.case_no = ${n} and ${mayHandle(staff)}`);
  const found = mine[0];
  if (!found) return { ok: false, code: "not_found" };
  if (found.status === wanted.status) return { ok: true, status: wanted.status, changed: false };

  const now = Date.now();
  const id = found.id;
  const guard = and(eq(reports.id, id), eq(reports.status, found.status));
  const event = (type: "review_started" | "closed" | "reopened", detail: string) =>
    db.insert(reportEvents).select(
      // Only if the update just above really changed this case (changes() is its row count).
      sql`select ${newId("reportEvent")}, ${id}, ${staff.userId}, ${type}, ${detail}, ${now} where changes() = 1`,
    );

  if (wanted.status === "reviewing") {
    // Only an open case can be taken; a closed one is reopened first.
    if (found.status !== "open") return { ok: true, status: found.status as ReportStatus, changed: false };
    await db.batch([db.update(reports).set({ status: "reviewing", handledBy: staff.userId, updatedAt: new Date(now) }).where(guard), event("review_started", "")]);
  } else if (wanted.status === "closed") {
    await db.batch([
      db
        .update(reports)
        .set({ status: "closed", outcome: wanted.outcome, resolutionNote: wanted.note, handledBy: staff.userId, closedAt: new Date(now), updatedAt: new Date(now) })
        .where(guard),
      event("closed", wanted.outcome),
    ]);
  } else {
    // Only a closed case can be reopened. Reopening is refused if the reporter has since filed a new live case on the same post.
    if (found.status !== "closed") return { ok: true, status: found.status as ReportStatus, changed: false };
    try {
      await db.batch([
        db.update(reports).set({ status: "open", outcome: null, closedAt: null, handledBy: null, updatedAt: new Date(now) }).where(guard),
        event("reopened", ""),
      ]);
    } catch {
      return { ok: false, code: "not_found" };
    }
  }
  const after = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, id)).get();
  return { ok: true, status: (after?.status ?? wanted.status) as ReportStatus, changed: true };
}

/** Takes an open case. */
export const startReview = (db: Db, staff: Staff, caseNo: unknown) => move(db, staff, caseNo, { status: "reviewing" });

/** Opens a closed case again. */
export const reopenCase = (db: Db, staff: Staff, caseNo: unknown) => move(db, staff, caseNo, { status: "open" });

/** Closes a case with how it ended and, if wanted, a note for the other staff (the reporter never sees the note). */
export async function closeCase(db: Db, staff: Staff, caseNo: unknown, outcome: unknown, note: unknown): Promise<CaseChange> {
  if (!isReportOutcome(outcome)) return { ok: false, code: "bad_outcome" };
  const checked = checkReportNote(note);
  if (!checked.ok) return { ok: false, code: checked.reason === "too_long" ? "note_too_long" : "bad_note" };
  return move(db, staff, caseNo, { status: "closed", outcome, note: checked.text });
}
