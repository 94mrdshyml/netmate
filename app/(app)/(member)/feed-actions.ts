"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMember } from "@/auth/session";
import { getDb } from "@/db";
import { countNewPosts } from "@/server/feed-news";
import { listForYou } from "@/server/for-you";
import { listFeed, type PostView } from "@/server/posts";

// Every action checks the session itself and never trusts an id from the browser (CLAUDE.md rule 5).

/** How many new posts from people you follow since the page was drawn (docs/PRD.md section 8.3). Quiet on any failure. */
export async function countNewPostsAction(since: number): Promise<number> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const parsed = z.number().int().safeParse(since);
  if (!parsed.success) return 0;
  const { env } = await getCloudflareContext({ async: true });
  try {
    return await countNewPosts(getDb(env.DB), member.userId, parsed.data);
  } catch {
    return 0;
  }
}

const more = z.object({ feed: z.enum(["for-you", "following"]), cursor: z.string().min(1).max(120) });

export type LoadMoreResult = { ok: true; items: PostView[]; nextCursor: string | null } | { ok: false };

/** The next page of Home, for load-on-scroll. The cursor is the one the last page gave; a bad one starts the feed again. */
export async function loadMoreAction(feed: string, cursor: string): Promise<LoadMoreResult> {
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const parsed = more.safeParse({ feed, cursor });
  if (!parsed.success) return { ok: false };
  const { env } = await getCloudflareContext({ async: true });
  try {
    const db = getDb(env.DB);
    const page =
      parsed.data.feed === "following"
        ? await listFeed(db, member.userId, { cursor: parsed.data.cursor, scope: "following" })
        : await listForYou(db, member.userId, { cursor: parsed.data.cursor });
    return { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch {
    return { ok: false };
  }
}
