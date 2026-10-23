import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { profiles, user } from "@/db/schema";
import { newId } from "@/lib/ids";
import { setFollow } from "@/server/follows";
import { createPost, deletePost, setRepost } from "@/server/posts";
import { setBlock, setPrivate } from "@/server/privacy";
import { getProfile } from "@/server/profiles";

const db = () => getDb(env.DB);

let n = 0;
async function member() {
  const i = ++n;
  const id = newId("user");
  await db().insert(user).values({ id, name: "x", email: `pp${i}@example.com` });
  await db().insert(profiles).values({ userId: id, username: `pp_${i}`, firstName: `Pia${i}`, lastName: "Posts" });
  return { id, username: `pp_${i}` };
}

const idOf = (r: Awaited<ReturnType<typeof createPost>>) => (r as { id: string }).id;
const posts = async (viewerId: string, username: string) => (await getProfile(db(), viewerId, username))?.postCount;

describe("the post count on a profile", () => {
  it("is zero for someone who has not posted, and counts each post", async () => {
    const author = await member();
    const reader = await member();
    expect(await posts(reader.id, author.username)).toBe(0);
    await createPost(db(), author.id, "one");
    await createPost(db(), author.id, "two");
    expect(await posts(reader.id, author.username)).toBe(2);
  });

  it("counts the posts on the Posts tab only: not replies, not reposts, not deleted posts", async () => {
    const author = await member();
    const other = await member();
    const reader = await member();
    const mine = idOf(await createPost(db(), author.id, "a post"));
    const gone = idOf(await createPost(db(), author.id, "will be deleted"));
    await createPost(db(), author.id, "a reply", mine);
    await createPost(db(), author.id, "a quote", undefined, [], undefined, undefined, mine);
    const theirs = idOf(await createPost(db(), other.id, "someone else's"));
    await setRepost(db(), author.id, theirs, true);
    // a post, a deleted post, a quote: the quote is a top-level post of its own.
    expect(await posts(reader.id, author.username)).toBe(3);
    await deletePost(db(), author.id, gone);
    expect(await posts(reader.id, author.username)).toBe(2);
  });

  it("is counted per person, and you see your own", async () => {
    const a = await member();
    const b = await member();
    await createPost(db(), a.id, "from a");
    await createPost(db(), b.id, "from b");
    await createPost(db(), b.id, "again from b");
    expect(await posts(a.id, a.username)).toBe(1);
    expect(await posts(a.id, b.username)).toBe(2);
  });

  it("is hidden (null) when their posts are hidden from you: a private account you do not follow, or a block", async () => {
    const author = await member();
    const stranger = await member();
    const follower = await member();
    await createPost(db(), author.id, "secret one");
    await setFollow(db(), follower.id, author.id, true);
    await setPrivate(db(), author.id, true);
    // The follow made before going private stays; the stranger never followed.
    expect(await posts(stranger.id, author.username)).toBeNull();
    expect(await posts(follower.id, author.username)).toBe(1);
    expect(await posts(author.id, author.username)).toBe(1);
    await setPrivate(db(), author.id, false);
    expect(await posts(stranger.id, author.username)).toBe(1);
    await setBlock(db(), author.id, stranger.id, true);
    expect(await posts(stranger.id, author.username)).toBeNull();
  });
});
