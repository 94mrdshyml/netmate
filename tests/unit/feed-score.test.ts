import { describe, expect, it } from "vitest";
import { FEED, closenessPart, freshnessPart, rank, reactionPart, scorePost, type ScoreInput } from "@/lib/feed-score";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const HOUR = 3_600_000;

const base: ScoreInput = { likes: 0, reposts: 0, replies: 0, reachedAt: NOW, now: NOW, near: true, affinity: 0, friends: 0, seen: false, own: false };

describe("the reaction part", () => {
  it("is 1 for a post nobody reacted to", () => {
    expect(reactionPart(0, 0, 0)).toBe(1);
  });
  it("counts a repost and a reply as two likes", () => {
    expect(reactionPart(0, 1, 0)).toBeCloseTo(reactionPart(2, 0, 0));
    expect(reactionPart(0, 0, 1)).toBeCloseTo(reactionPart(2, 0, 0));
  });
  it("counts the tenth like for much less than the first", () => {
    const first = reactionPart(1, 0, 0) - reactionPart(0, 0, 0);
    const tenth = reactionPart(10, 0, 0) - reactionPart(9, 0, 0);
    expect(tenth).toBeLessThan(first / 4);
  });
});

describe("freshness", () => {
  it("halves every 12 hours", () => {
    expect(freshnessPart(NOW, NOW)).toBe(1);
    expect(freshnessPart(NOW - 12 * HOUR, NOW)).toBeCloseTo(0.5);
    expect(freshnessPart(NOW - 24 * HOUR, NOW)).toBeCloseTo(0.25);
  });
  it("does not go above 1 for a time in the future", () => {
    expect(freshnessPart(NOW + HOUR, NOW)).toBe(1);
  });
});

describe("closeness", () => {
  it("is 1 for people the reader follows and 0.4 for a stranger", () => {
    expect(closenessPart(true, 0, 0)).toBe(1);
    expect(closenessPart(false, 0, 0)).toBeCloseTo(0.4);
  });
  it("adds 15% for each recent like, repost, save or reply, up to 8", () => {
    expect(closenessPart(true, 1, 0)).toBeCloseTo(1.15);
    expect(closenessPart(true, 8, 0)).toBeCloseTo(2.2);
    expect(closenessPart(true, 20, 0)).toBeCloseTo(2.2);
  });
  it("adds 25% for each followed person who liked or reposted a stranger's post, up to 4, and not for followed authors", () => {
    expect(closenessPart(false, 0, 1)).toBeCloseTo(0.4 * 1.25);
    expect(closenessPart(false, 0, 4)).toBeCloseTo(0.4 * 2);
    expect(closenessPart(false, 0, 9)).toBeCloseTo(0.4 * 2);
    expect(closenessPart(true, 0, 3)).toBe(1);
  });
});

describe("the whole score", () => {
  it("multiplies the parts, and a seen post counts 0.15", () => {
    const fresh = scorePost(base);
    expect(fresh).toBe(1);
    expect(scorePost({ ...base, seen: true })).toBeCloseTo(FEED.seenFactor);
    expect(scorePost({ ...base, near: false })).toBeCloseTo(0.4);
    expect(scorePost({ ...base, reachedAt: NOW - 12 * HOUR, likes: 3 })).toBeCloseTo(reactionPart(3, 0, 0) * 0.5);
  });
  it("ranks a fresh quiet post of a friend above an old busy post of a stranger", () => {
    const friend = scorePost({ ...base });
    const stranger = scorePost({ ...base, near: false, likes: 20, reachedAt: NOW - 36 * HOUR });
    expect(friend).toBeGreaterThan(stranger);
  });
});

describe("the post you just wrote", () => {
  it("goes before everything else for ten minutes, then ranks like any post", () => {
    const busy = scorePost({ ...base, likes: 500, reposts: 100, replies: 100, affinity: 8 });
    expect(scorePost({ ...base, own: true })).toBeGreaterThan(busy);
    expect(scorePost({ ...base, own: true, reachedAt: NOW - 9 * 60_000 })).toBeGreaterThan(busy);
    expect(scorePost({ ...base, own: true, reachedAt: NOW - 11 * 60_000 })).toBeLessThan(1);
  });
  it("is for your own posts only", () => {
    expect(scorePost({ ...base, own: false })).toBe(1);
  });
});

describe("the same author again", () => {
  const e = (id: string, authorId: string, score: number, at = 0) => ({ id, authorId, score, at });

  it("counts the second post by an author 0.7 of its score and the third 0.7 x 0.7", () => {
    const out = rank([e("a1", "A", 10), e("a2", "A", 9), e("a3", "A", 8), e("b1", "B", 5)]);
    // a2 = 9 x 0.7 = 6.3, a3 = 8 x 0.49 = 3.92, b1 = 5
    expect(out.map((x) => x.id)).toEqual(["a1", "a2", "b1", "a3"]);
  });
  it("lets a stronger post of another author go first", () => {
    const out = rank([e("a1", "A", 10), e("a2", "A", 9), e("b1", "B", 7)]);
    // a2 = 6.3 < 7
    expect(out.map((x) => x.id)).toEqual(["a1", "b1", "a2"]);
  });
  it("breaks ties by the newer post, then the larger id, the same way every time", () => {
    const out = rank([e("p1", "A", 1, 5), e("p2", "B", 1, 9), e("p3", "C", 1, 9)]);
    expect(out.map((x) => x.id)).toEqual(["p3", "p2", "p1"]);
    expect(rank([...out].reverse()).map((x) => x.id)).toEqual(["p3", "p2", "p1"]);
  });
  it("leaves an empty list empty", () => {
    expect(rank([])).toEqual([]);
  });
});
