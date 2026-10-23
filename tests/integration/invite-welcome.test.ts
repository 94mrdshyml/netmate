import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/auth";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { inviteWelcome, WELCOME_FACES, WELCOME_NAMES } from "@/server/invite-welcome";
import { ensureInviteLink } from "@/server/invites";

const authEnv = () => ({ DB: env.DB, AUTH_SECRET: (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET });
const db = () => getDb(env.DB);

let counter = 0;
let adminMade = false;

async function makeMember(
  first: string,
  options: { status?: "active" | "pending"; isPrivate?: boolean; role?: "admin" | "member"; avatarKey?: string } = {},
) {
  const n = ++counter;
  const role = options.role ?? "member";
  if (role === "admin") adminMade = true;
  const { user } = await createAuth(authEnv()).api.signUpEmail({
    body: { email: `welcome${n}@example.com`, password: "a-long-enough-pass", name: `${first} Test` },
  });
  await db().insert(profiles).values({
    userId: user.id,
    username: `welcome_${n}`,
    firstName: first,
    lastName: "Test",
    role,
    status: options.status ?? "active",
    isPrivate: options.isPrivate ?? false,
    avatarKey: options.avatarKey ?? null,
    createdAt: new Date(1_700_000_000_000 + n * 1000),
  });
  return user.id;
}

describe("inviteWelcome", () => {
  it("puts the inviter first, then the earliest members, at most four faces and three names", async () => {
    if (!adminMade) await makeMember("Ada", { role: "admin" });
    const inviter = await makeMember("Ines");
    await makeMember("Ben");
    await makeMember("Cleo");
    await makeMember("Dev");
    await makeMember("Eli");

    const welcome = await inviteWelcome(db(), { ownerUserId: inviter });
    expect(welcome).not.toBeNull();
    expect(welcome!.inviterFirstName).toBe("Ines");
    expect(welcome!.faces[0]!.userId).toBe(inviter);
    expect(welcome!.faces).toHaveLength(WELCOME_FACES);
    expect(welcome!.names).toHaveLength(WELCOME_NAMES);
    expect(welcome!.names[0]).toBe("Ines");
    // Faces after the inviter are in the order people joined, and the inviter is not shown twice.
    expect(new Set(welcome!.faces.map((f) => f.userId)).size).toBe(welcome!.faces.length);
  });

  it("counts everyone else as others, so the line can say 'and 6 others'", async () => {
    const inviter = await makeMember("Odile");
    const welcome = await inviteWelcome(db(), { ownerUserId: inviter });
    const total = (await env.DB.prepare("select count(*) as n from profiles where status = 'active'").first<{ n: number }>())!.n;
    expect(welcome!.others).toBe(total - welcome!.names.length);
    expect(welcome!.others).toBeGreaterThan(0);
  });

  it("never shows a Pending or a private member, but always shows the inviter", async () => {
    const inviter = await makeMember("Paula", { isPrivate: true });
    const waiting = await makeMember("Wendell", { status: "pending" });
    const hidden = await makeMember("Hanne", { isPrivate: true });

    const welcome = await inviteWelcome(db(), { ownerUserId: inviter });
    const ids = welcome!.faces.map((f) => f.userId);
    expect(ids).toContain(inviter);
    expect(ids).not.toContain(waiting);
    expect(ids).not.toContain(hidden);
    expect(welcome!.names).not.toContain("Wendell");
    expect(welcome!.names).not.toContain("Hanne");
  });

  it("gives only first names and picture keys, nothing else about a person", async () => {
    const inviter = await makeMember("Quinn", { avatarKey: "avatar/abcdefghijklmnopqrstuvwx.png" });
    const welcome = await inviteWelcome(db(), { ownerUserId: inviter });
    for (const face of welcome!.faces) expect(Object.keys(face).sort()).toEqual(["avatarKey", "firstName", "userId"]);
    expect(welcome!.faces[0]!.avatarKey).toBe("avatar/abcdefghijklmnopqrstuvwx.png");
    expect(JSON.stringify(welcome)).not.toContain("@example.com");
    expect(JSON.stringify(welcome)).not.toContain("welcome_");
  });

  it("returns nothing when the inviter is not an active member", async () => {
    const waiting = await makeMember("Wren", { status: "pending" });
    expect(await inviteWelcome(db(), { ownerUserId: waiting })).toBeNull();
    expect(await inviteWelcome(db(), { ownerUserId: "usr_" + "x".repeat(24) })).toBeNull();
  });

  it("works with a link made the usual way", async () => {
    const owner = await makeMember("Lena");
    const link = await ensureInviteLink(db(), owner);
    const welcome = await inviteWelcome(db(), { ownerUserId: link.ownerUserId });
    expect(welcome!.inviterFirstName).toBe("Lena");
    await db().update(profiles).set({ status: "pending" }).where(eq(profiles.userId, owner));
    expect(await inviteWelcome(db(), { ownerUserId: owner })).toBeNull();
  });
});
