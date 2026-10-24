import { describe, expect, it } from "vitest";
import { isStaff } from "@/auth/roles";

describe("who counts as staff for the members and activity pages", () => {
  it("is the admin or a moderator, and nobody else", () => {
    expect(isStaff({ role: "admin", moderator: false })).toBe(true);
    expect(isStaff({ role: "member", moderator: true })).toBe(true);
    expect(isStaff({ role: "member", moderator: false })).toBe(false);
  });
});
