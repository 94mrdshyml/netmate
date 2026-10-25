// What staff can do after a report (docs/PRD.md section 8.8a; owner decision, session 64): take a reported post down, and pause
// a member's account. The admin and the moderators may both, with these limits: nobody takes down or suspends the owner, a
// moderator cannot act on another moderator, and nobody acts on themselves. Every change is one `db.batch()`, sends the state
// wanted (so a repeat changes nothing), and is safe if two staff press at once. Pages and actions call these; they never write SQL.
//
// A removal is the same soft delete an author's own Delete is (the row stays, `deleted_at` is set), so the post is gone from
// every list through `visiblePosts`. The author is told a post was removed and nothing else: not who, not why, and never that a
// report exists.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { notifications, posts, profiles, reportEvents, reports, session } from "@/db/schema";
import { isId, newId } from "@/lib/ids";
import { checkReportNote, parseCaseId } from "@/lib/report-categories";
import { mayHandle, type Staff } from "@/server/reports";

/** The most cases closed by one removal (a post is rarely reported by more than a handful of people). */
const MAX_CASES = 50;

export type RemoveResult =
  | { ok: true; /** The cases this closed, for the emails to the people who reported. */ closed: number[] }
  | { ok: false; code: "not_found" | "gone" | "owner" | "moderator" | "bad_note" | "note_too_long" };

/**
 * Takes down the post a case is about, and closes every live case this person may handle about that post as "Post removed",
 * each with its history entry and an alert to its reporter. The author gets one alert. `rawNote` is staff's own note on the
 * case being worked (optional, never shown to the reporter or the author).
 */
export async function removePostFromCase(db: Db, staff: Staff, caseNo: unknown, rawNote: unknown): Promise<RemoveResult> {
  const n = typeof caseNo === "number" ? caseNo : parseCaseId(caseNo);
  if (n === null || !Number.isSafeInteger(n) || n < 1) return { ok: false, code: "not_found" };
  const note = checkReportNote(rawNote);
  if (!note.ok) return { ok: false, code: note.reason === "too_long" ? "note_too_long" : "bad_note" };

  const [found] = await db.all<{ id: string; postId: string | null }>(sql`select r.id as id, r.post_id as postId from reports r where r.case_no = ${n} and ${mayHandle(staff)}`);
  if (!found) return { ok: false, code: "not_found" };
  if (!found.postId) return { ok: false, code: "gone" };

  const post = await db
    .select({ authorId: posts.authorId, parentId: posts.parentId, deletedAt: posts.deletedAt })
    .from(posts)
    .where(eq(posts.id, found.postId))
    .get();
  if (!post || post.deletedAt) return { ok: false, code: "gone" };

  const author = await db.select({ role: profiles.role, isModerator: profiles.isModerator }).from(profiles).where(eq(profiles.userId, post.authorId)).get();
  if (author?.role === "admin") return { ok: false, code: "owner" };
  if (author?.isModerator && !staff.isAdmin) return { ok: false, code: "moderator" };

  const live = await db.all<{ id: string; caseNo: number }>(
    sql`select r.id as id, r.case_no as caseNo from reports r where r.post_id = ${found.postId} and r.status <> 'closed' and ${mayHandle(staff)} order by r.case_no limit ${MAX_CASES}`,
  );
  const now = Date.now();
  const postId = found.postId;

  const perCase = live.flatMap((c) => {
    const stillLive = sql`exists (select 1 from reports where id = ${c.id} and status <> 'closed')`;
    return [
      // The reporter's alert from an earlier closing goes, so this one is new; then the history entry and the alert, then the case itself.
      db.delete(notifications).where(and(eq(notifications.reportId, c.id), eq(notifications.type, "report_closed"), stillLive)),
      db.insert(reportEvents).select(sql`select ${newId("reportEvent")}, ${c.id}, ${staff.userId}, 'closed', 'removed', ${now} where ${stillLive}`),
      db
        .insert(notifications)
        .select(
          sql`select ${newId("notification")}, r.reporter_id, ${staff.userId}, 'report_closed', null, ${now}, null, r.id
              from reports r where r.id = ${c.id} and r.status <> 'closed' and r.reporter_id is not null and r.reporter_id <> ${staff.userId}`,
        )
        .onConflictDoNothing(),
      db
        .update(reports)
        .set({
          status: "closed",
          outcome: "removed",
          handledBy: staff.userId,
          closedAt: new Date(now),
          updatedAt: new Date(now),
          ...(c.id === found.id && note.text ? { resolutionNote: note.text } : {}),
        })
        .where(and(eq(reports.id, c.id), sql`${reports.status} <> 'closed'`)),
    ];
  });

  await db.batch([
    ...perCase,
    // The soft delete (the same as the author's own Delete), the author's alert written only if it really took the post down, and a reply's parent counted again.
    db.update(posts).set({ deletedAt: new Date(now) }).where(and(eq(posts.id, postId), sql`${posts.deletedAt} is null`)),
    db
      .insert(notifications)
      .select(
        sql`select ${newId("notification")}, ${post.authorId}, ${staff.userId}, 'post_removed', ${postId}, ${now}, null, null where changes() = 1`,
      )
      .onConflictDoNothing(),
    ...(post.parentId
      ? [
          db
            .update(posts)
            .set({ replyCount: sql`(select count(*) from ${posts} as r where r.parent_id = ${post.parentId} and r.deleted_at is null)` })
            .where(eq(posts.id, post.parentId)),
        ]
      : []),
  ] as unknown as Parameters<Db["batch"]>[0]);

  return { ok: true, closed: live.map((c) => c.caseNo) };
}

// ---- suspending a member ----

export type SuspendResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: "not_found" | "self" | "owner" | "moderator" | "not_active" | "bad_note" | "note_too_long" };

/** Checks who may act on whom: not yourself, never the owner, and a moderator only on ordinary members. */
async function target(db: Db, staff: Staff, userId: unknown) {
  if (!isId("user", userId)) return { ok: false as const, code: "not_found" as const };
  const person = await db.select({ role: profiles.role, isModerator: profiles.isModerator, status: profiles.status }).from(profiles).where(eq(profiles.userId, userId)).get();
  if (!person) return { ok: false as const, code: "not_found" as const };
  if (person.role === "admin") return { ok: false as const, code: "owner" as const };
  if (userId === staff.userId) return { ok: false as const, code: "self" as const };
  if (person.isModerator && !staff.isAdmin) return { ok: false as const, code: "moderator" as const };
  return { ok: true as const, userId, status: person.status };
}

/**
 * Pauses a member's account: signed out at once everywhere, cannot sign in, and their profile and posts leave every screen but
 * staff's until it is lifted. Only an active member can be suspended; doing it again changes nothing.
 */
export async function suspendMember(db: Db, staff: Staff, userId: unknown, rawNote: unknown): Promise<SuspendResult> {
  const t = await target(db, staff, userId);
  if (!t.ok) return t;
  const note = checkReportNote(rawNote);
  if (!note.ok) return { ok: false, code: note.reason === "too_long" ? "note_too_long" : "bad_note" };
  if (t.status === "suspended") return { ok: true, changed: false };
  if (t.status !== "active") return { ok: false, code: "not_active" };

  const [changed] = await db.batch([
    db
      .update(profiles)
      .set({ status: "suspended", suspendedAt: new Date(), suspendedBy: staff.userId, suspensionNote: note.text })
      .where(and(eq(profiles.userId, t.userId), eq(profiles.status, "active")))
      .returning({ id: profiles.userId }),
    // Every phone they are signed in on stops being signed in (and a session is also refused on its own while the account is not active).
    db.delete(session).where(eq(session.userId, t.userId)),
  ]);
  return { ok: true, changed: changed.length > 0 };
}

/** Lifts a suspension: the account, the profile and the posts come back as they were. Lifting one that is not suspended changes nothing. */
export async function liftSuspension(db: Db, staff: Staff, userId: unknown): Promise<SuspendResult> {
  const t = await target(db, staff, userId);
  if (!t.ok) return t;
  if (t.status !== "suspended") return { ok: true, changed: false };
  const lifted = await db
    .update(profiles)
    .set({ status: "active", suspendedAt: null, suspendedBy: null, suspensionNote: "" })
    .where(and(eq(profiles.userId, t.userId), eq(profiles.status, "suspended")))
    .returning({ id: profiles.userId });
  return { ok: true, changed: lifted.length > 0 };
}
