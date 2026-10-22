import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { DEFAULT_SETTINGS, clearInstanceCache, readInstance, readInstanceCached } from "@/instance/settings";
import { newId } from "@/lib/ids";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const db = getDb(env.DB);
const { instance, instanceSecrets, inviteLinks, inviteUses, profiles, user } = schema;

type NewInstance = typeof instance.$inferInsert;

const validInstance: NewInstance = {
  name: "Green Valley School",
  primaryColor: "#0B6E4F",
  radius: "lg",
  fontFamily: "Space Grotesk",
  avatarStyle: "thumbs",
};

async function makeUser(label: string): Promise<string> {
  const id = newId("user");
  await db.insert(user).values({ id, name: label, email: `${label}-${id}@example.com` });
  return id;
}

/** Drizzle wraps the driver error; the SQLite message is on `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp, label = "this") {
  let message = "";
  try {
    await promise;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    message = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  }
  expect(message, `expected the database to reject: ${label}`).toMatch(pattern);
}

beforeEach(async () => {
  clearInstanceCache();
  await env.DB.batch([
    env.DB.prepare("delete from invite_uses"),
    env.DB.prepare("delete from invite_links"),
    env.DB.prepare("delete from profiles"),
    env.DB.prepare("delete from instance_secrets"),
    env.DB.prepare("delete from instance"),
    env.DB.prepare("delete from user"),
  ]);
});

describe("instance settings", () => {
  it("reports an unconfigured instance with the defaults before setup", async () => {
    const state = await readInstance(db);
    expect(state.configured).toBe(false);
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("reports the saved settings once the row exists", async () => {
    await db.insert(instance).values({ ...validInstance, inviteQuota: 8, gifsEnabled: true });
    const state = await readInstance(db);
    expect(state.configured).toBe(true);
    expect(state.settings).toMatchObject({
      name: "Green Valley School",
      primaryColor: "#0B6E4F",
      radius: "lg",
      fontFamily: "Space Grotesk",
      avatarStyle: "thumbs",
      themeDefault: "system",
      inviteQuota: 8,
      gifsEnabled: true,
      placesEnabled: false,
    });
  });

  it("allows setup to happen only once: a second row is rejected", async () => {
    await db.insert(instance).values(validInstance);
    await expectDbError(db.insert(instance).values({ ...validInstance, name: "Second" }), /UNIQUE|constraint/i);
    await expectDbError(
      db.insert(instance).values({ ...validInstance, id: "another" }),
      /CHECK constraint failed/i,
    );
    expect((await db.select().from(instance).all()).length).toBe(1);
  });

  it("rejects values the app would not accept", async () => {
    const bad: [string, Partial<NewInstance>][] = [
      ["empty name", { name: "" }],
      ["name over 30", { name: "x".repeat(31) }],
      ["colour word", { primaryColor: "red" }],
      ["colour with a trailing character", { primaryColor: "#abcZ" }],
      ["colour with 5 digits", { primaryColor: "#12345" }],
      ["css injection", { primaryColor: "#fff;}body{x:y" }],
      ["unknown radius", { radius: "huge" }],
      ["unknown theme default", { themeDefault: "sepia" }],
      ["negative quota", { inviteQuota: -1 }],
      ["unknown sign-up policy", { signupPolicy: "open" }],
    ];
    for (const [label, override] of bad) {
      await expectDbError(db.insert(instance).values({ ...validInstance, ...override }), /CHECK constraint failed/i, label);
    }
    expect((await db.select().from(instance).all()).length).toBe(0);
  });

  it("accepts three and six digit colours in either case", async () => {
    for (const color of ["#abc", "#ABCDEF", "#a1B2c3"]) {
      await env.DB.prepare("delete from instance").run();
      await db.insert(instance).values({ ...validInstance, primaryColor: color });
    }
  });

  it("caches the read for a short time, and the cache can be cleared", async () => {
    const t0 = 1_000_000;
    expect((await readInstanceCached(db, t0)).configured).toBe(false);

    await db.insert(instance).values(validInstance);
    // Still the cached answer inside the TTL.
    expect((await readInstanceCached(db, t0 + 5_000)).configured).toBe(false);
    // After saving, the isolate clears its cache and sees the change at once.
    clearInstanceCache();
    expect((await readInstanceCached(db, t0 + 5_001)).configured).toBe(true);
    // Another isolate would catch up after the TTL.
    await env.DB.prepare("delete from instance").run();
    expect((await readInstanceCached(db, t0 + 60_000)).configured).toBe(false);
  });
});

describe("encrypted secrets", () => {
  const KEY = "s".repeat(48);

  it("stores only ciphertext and decrypts it back", async () => {
    const value = await encryptSecret("re_live_secret_value", "resend_api_key", KEY);
    await db.insert(instanceSecrets).values({ name: "resend_api_key", value });

    const row = await env.DB.prepare("select value from instance_secrets where name = 'resend_api_key'").first<{ value: string }>();
    expect(row?.value).not.toContain("re_live_secret_value");
    expect(await decryptSecret(row?.value ?? "", "resend_api_key", KEY)).toBe("re_live_secret_value");
  });

  it("only allows the known secret names", async () => {
    await expectDbError(db.insert(instanceSecrets).values({ name: "anything", value: "v1:a:b" }), /CHECK constraint failed/i);
  });
});

describe("profiles", () => {
  const base = { firstName: "Riya", lastName: "Sen" };

  it("stores a profile for a user and removes it when the user is deleted", async () => {
    const id = await makeUser("riya");
    await db.insert(profiles).values({ userId: id, username: "riya_sen", ...base });
    const row = await db.select().from(profiles).get();
    expect(row).toMatchObject({ username: "riya_sen", role: "member", status: "active", isPrivate: false, bio: "" });

    await env.DB.prepare("delete from user where id = ?").bind(id).run();
    expect((await db.select().from(profiles).all()).length).toBe(0);
  });

  it("enforces the username rules in the database", async () => {
    const id = await makeUser("u");
    for (const username of ["ab", "a".repeat(16), "Riya", "riya-sen", "riya.sen", "riya sen", "rïya", "@riya"]) {
      await expectDbError(
        db.insert(profiles).values({ userId: id, username, ...base }),
        /CHECK constraint failed/i,
      );
    }
    await db.insert(profiles).values({ userId: id, username: "a_1", ...base });
  });

  it("keeps usernames unique", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    await db.insert(profiles).values({ userId: a, username: "same_name", ...base });
    await expectDbError(db.insert(profiles).values({ userId: b, username: "same_name", ...base }), /UNIQUE/i);
  });

  it("allows exactly one admin", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    await db.insert(profiles).values({ userId: a, username: "admin_one", role: "admin", ...base });
    await expectDbError(
      db.insert(profiles).values({ userId: b, username: "admin_two", role: "admin", ...base }),
      /UNIQUE/i,
    );
    // Any number of members is fine.
    await db.insert(profiles).values({ userId: b, username: "member_b", ...base });
    await db.insert(profiles).values({ userId: c, username: "member_c", ...base });
  });

  it("rejects an unknown role or status and an over-long bio or name", async () => {
    const id = await makeUser("u");
    const cases: Record<string, unknown>[] = [
      { role: "owner" },
      { status: "banned" },
      { bio: "x".repeat(161) },
      { firstName: "" },
      { lastName: "x".repeat(51) },
    ];
    for (const override of cases) {
      await expectDbError(
        db.insert(profiles).values({ userId: id, username: "valid_name", ...base, ...override } as never),
        /CHECK constraint failed/i,
      );
    }
  });

  it("keeps the profile and forgets the inviter when the inviter is deleted", async () => {
    const inviter = await makeUser("inviter");
    const guest = await makeUser("guest");
    await db.insert(profiles).values({ userId: inviter, username: "inviter_x", ...base });
    await db.insert(profiles).values({ userId: guest, username: "guest_x", invitedBy: inviter, ...base });

    await env.DB.prepare("delete from user where id = ?").bind(inviter).run();
    const row = await db.select().from(profiles).get();
    expect(row?.username).toBe("guest_x");
    expect(row?.invitedBy).toBeNull();
  });

  it("refuses a profile for a user that does not exist", async () => {
    await expectDbError(
      db.insert(profiles).values({ userId: newId("user"), username: "ghost_x", ...base }),
      /FOREIGN KEY/i,
    );
  });
});

describe("invite links", () => {
  it("allows one active link per member, and a new one after revoking", async () => {
    const owner = await makeUser("owner");
    const first = newId("inviteLink");
    await db.insert(inviteLinks).values({ id: first, ownerUserId: owner, code: "code-one-aaaaaaaaaaaaaaaaaaaa" });

    await expectDbError(
      db.insert(inviteLinks).values({ id: newId("inviteLink"), ownerUserId: owner, code: "code-two-bbbbbbbbbbbbbbbbbbbb" }),
      /UNIQUE/i,
    );

    await env.DB.prepare("update invite_links set revoked_at = ? where id = ?").bind(Date.now(), first).run();
    await db.insert(inviteLinks).values({ id: newId("inviteLink"), ownerUserId: owner, code: "code-three-cccccccccccccccccc" });
  });

  it("keeps codes unique across all links", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    await db.insert(inviteLinks).values({ id: newId("inviteLink"), ownerUserId: a, code: "shared-code-0000000000000" });
    await expectDbError(
      db.insert(inviteLinks).values({ id: newId("inviteLink"), ownerUserId: b, code: "shared-code-0000000000000" }),
      /UNIQUE/i,
    );
  });

  it("records one use per person, with a valid outcome", async () => {
    const owner = await makeUser("owner");
    const guest = await makeUser("guest");
    const linkId = newId("inviteLink");
    await db.insert(inviteLinks).values({ id: linkId, ownerUserId: owner, code: "code-use-ddddddddddddddddd" });

    await db.insert(inviteUses).values({ id: newId("inviteUse"), inviteLinkId: linkId, userId: guest, outcome: "approved" });
    await expectDbError(
      db.insert(inviteUses).values({ id: newId("inviteUse"), inviteLinkId: linkId, userId: guest, outcome: "pending" }),
      /UNIQUE/i,
    );

    const other = await makeUser("other");
    await expectDbError(
      db.insert(inviteUses).values({ id: newId("inviteUse"), inviteLinkId: linkId, userId: other, outcome: "maybe" }),
      /CHECK constraint failed/i,
    );
  });

  it("removes links and uses when their owner is deleted", async () => {
    const owner = await makeUser("owner");
    const guest = await makeUser("guest");
    const linkId = newId("inviteLink");
    await db.insert(inviteLinks).values({ id: linkId, ownerUserId: owner, code: "code-del-eeeeeeeeeeeeeeeee" });
    await db.insert(inviteUses).values({ id: newId("inviteUse"), inviteLinkId: linkId, userId: guest, outcome: "approved" });

    await env.DB.prepare("delete from user where id = ?").bind(owner).run();
    expect((await db.select().from(inviteLinks).all()).length).toBe(0);
    expect((await db.select().from(inviteUses).all()).length).toBe(0);
  });
});
