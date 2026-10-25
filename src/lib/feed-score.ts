// The "For you" score (docs/PRD.md section 8.3). Pure: no database, no clock. Every number is named here, so tuning
// the feed is a change to this file only. The server fetches candidates and counts with simple SQL and uses these.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

export const FEED = {
  /** Only posts (and reposts) from this long ago are looked at. */
  windowMs: 7 * DAY,
  /** A post's freshness halves every this long, counted from when it reached the reader (the repost time for a repost). */
  halfLifeMs: 12 * HOUR,
  /** A reply or repost counts for this many likes. */
  repostWeight: 2,
  replyWeight: 2,
  /** Closeness: the reader, and people the reader follows, count 1; anyone else this. */
  strangerCloseness: 0.4,
  /** Each time in the last `affinityWindowMs` the reader liked, reposted, saved or replied to the author adds this share, up to `affinityMax` times. */
  affinityStep: 0.15,
  affinityMax: 8,
  affinityWindowMs: 30 * DAY,
  /** For a stranger's post, each person the reader follows who liked or reposted it adds this share, up to `friendMax` people. */
  friendStep: 0.25,
  friendMax: 4,
  /**
   * A post the reader wrote in the last `justPostedMs` goes before everything else, newest first, so the post you just wrote
   * is at the top when you land on Home (how Home always behaved; the Home tests rely on it). They form a group of their own
   * ahead of the ranked posts, in order of time, so reactions or the same-author rule cannot put an older one first.
   */
  justPostedMs: 10 * MINUTE,
  /** A post the reader has already seen counts this much of its score. */
  seenFactor: 0.15,
  /** The second post by one author counts this much of its score, the third this squared, and so on. */
  sameAuthorFactor: 0.7,
  /** A stranger's post is shown only with at least this many likes, reposts and replies in all, or one liked or reposted by someone the reader follows. */
  minTraction: 2,
  /** Candidates looked at from each source: posts of people the reader follows, strangers' posts, reposts. The newest come first. */
  poolMax: 300,
  /** Fewer than this many entries means a small instance: strangers' posts then need no traction, so the feed is not empty. */
  fillBelow: 20,
  /** Entries on one page. */
  pageSize: 20,
  /** A "next page" address made longer ago than this starts the feed again, so a page left open for hours does not freeze the ranking. */
  cursorMaxAgeMs: 2 * HOUR,
} as const;

export type ScoreInput = {
  likes: number;
  reposts: number;
  replies: number;
  /** When the post reached the reader: its own time, or the time of the repost that brought it. */
  reachedAt: number;
  now: number;
  /** The reader, someone the reader follows, or a post reposted by someone the reader follows. */
  near: boolean;
  /** How many times in the last 30 days the reader liked, reposted, saved or replied to the author. */
  affinity: number;
  /** For a stranger's post: how many people the reader follows liked or reposted it. */
  friends: number;
  seen: boolean;
};

/** `1 + ln(1 + likes + 2 x reposts + 2 x replies)`: the tenth like counts much less than the first. */
export function reactionPart(likes: number, reposts: number, replies: number): number {
  return 1 + Math.log(1 + likes + FEED.repostWeight * reposts + FEED.replyWeight * replies);
}

/** 1 for a post that just arrived, one half after a half-life, and so on. Never negative; a post from the future counts 1. */
export function freshnessPart(reachedAt: number, now: number): number {
  const age = Math.max(0, now - reachedAt);
  return Math.pow(0.5, age / FEED.halfLifeMs);
}

export function closenessPart(near: boolean, affinity: number, friends: number): number {
  const base = near ? 1 : FEED.strangerCloseness;
  const liked = 1 + FEED.affinityStep * Math.min(Math.max(affinity, 0), FEED.affinityMax);
  const byFriends = near ? 1 : 1 + FEED.friendStep * Math.min(Math.max(friends, 0), FEED.friendMax);
  return base * liked * byFriends;
}

export function scorePost(i: ScoreInput): number {
  return reactionPart(i.likes, i.reposts, i.replies) * freshnessPart(i.reachedAt, i.now) * closenessPart(i.near, i.affinity, i.friends) * (i.seen ? FEED.seenFactor : 1);
}

/** True for a post the reader wrote themself (not a repost of it) within the last `justPostedMs`. */
export function isJustPosted(own: boolean, reachedAt: number, now: number): boolean {
  return own && now - reachedAt >= 0 && now - reachedAt < FEED.justPostedMs;
}

export type Ranked = { score: number; authorId: string; at: number; id: string; justPosted?: boolean };

/**
 * Puts the entries in order, best first. The best post of each author keeps its score, the author's next counts
 * `sameAuthorFactor` of its own, the one after that that squared, and so on, so one busy author cannot fill the feed.
 * Ties go to the newer post, then to the larger id, so the order is the same every time it is worked out.
 * Posts the reader just wrote come first as a group, newest first, and take no part in the same-author rule.
 */
export function rank<T extends Ranked>(entries: T[]): T[] {
  const newer = (a: Ranked, b: Ranked) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const justPosted = entries.filter((e) => e.justPosted).sort(newer);
  const others = rankedOthers(entries.filter((e) => !e.justPosted));
  return [...justPosted, ...others];
}

function rankedOthers<T extends Ranked>(entries: T[]): T[] {
  const byScore = [...entries].sort((a, b) => b.score - a.score || b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const placed = new Map<string, number>();
  const adjusted = byScore.map((e) => {
    const before = placed.get(e.authorId) ?? 0;
    placed.set(e.authorId, before + 1);
    return { e, score: e.score * Math.pow(FEED.sameAuthorFactor, before) };
  });
  return adjusted.sort((a, b) => b.score - a.score || b.e.at - a.e.at || (a.e.id < b.e.id ? 1 : a.e.id > b.e.id ? -1 : 0)).map((x) => x.e);
}
