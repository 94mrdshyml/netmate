import { describe, expect, it } from "vitest";
import { AVATAR_STYLES, FONT_OPTIONS, RADIUS_OPTIONS } from "@/instance/options";
import { STEP_FIELDS, validateSetup, type SetupInput } from "@/instance/setup-schema";

const valid: SetupInput = {
  token: "anything",
  firstName: "Riya",
  lastName: "Sen",
  email: "Riya@Example.com",
  username: "Riya_Sen",
  password: "correct horse battery",
  name: "Green Valley School",
  primary: "#0B6E4F",
  radius: "lg",
  fontFamily: "Space Grotesk",
  avatarStyle: "thumbs",
  placesEnabled: false,
};

const errorsFor = (override: Partial<SetupInput>) => {
  const r = validateSetup({ ...valid, ...override });
  return r.success ? {} : r.errors;
};

describe("validateSetup", () => {
  it("accepts a complete, valid form and normalises it", () => {
    const r = validateSetup(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("riya@example.com");
      expect(r.data.resendApiKey).toBeUndefined();
      expect(r.data.klipyApiKey).toBeUndefined();
    }
  });

  it("trims names and turns empty optional fields into undefined", () => {
    const r = validateSetup({ ...valid, firstName: "  Riya ", klipyApiKey: "   ", resendApiKey: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.firstName).toBe("Riya");
      expect(r.data.klipyApiKey).toBeUndefined();
      expect(r.data.resendApiKey).toBeUndefined();
    }
  });

  it("applies the account rules from the PRD", () => {
    expect(errorsFor({ firstName: "" }).firstName).toBeTruthy();
    expect(errorsFor({ lastName: "x".repeat(51) }).lastName).toBeTruthy();
    expect(errorsFor({ email: "not-an-email" }).email).toBeTruthy();
    expect(errorsFor({ email: `${"a".repeat(250)}@example.com` }).email).toBeTruthy();
    expect(errorsFor({ password: "short" }).password).toBeTruthy();
    expect(errorsFor({ password: "x".repeat(129) }).password).toBeTruthy();
    expect(errorsFor({ password: "x".repeat(8) })).toEqual({});
  });

  it("applies the username rules, including the instance name", () => {
    expect(errorsFor({ username: "ab" }).username).toMatch(/3 to 15/);
    expect(errorsFor({ username: "riya-sen" }).username).toMatch(/letters, numbers/);
    expect(errorsFor({ username: "admin" }).username).toMatch(/reserved/);
    expect(errorsFor({ username: "setup" }).username).toMatch(/reserved/);
    expect(errorsFor({ username: "greenvalley", name: "Green Valley" }).username).toMatch(/reserved/);
    expect(errorsFor({ username: "greenvalley", name: "Other" })).toEqual({});
  });

  it("limits the instance name to 1 to 30 characters", () => {
    expect(errorsFor({ name: "" }).name).toBeTruthy();
    expect(errorsFor({ name: "x".repeat(31) }).name).toBeTruthy();
    expect(errorsFor({ name: "x".repeat(30) })).toEqual({});
  });

  it("only accepts the offered look choices and a real colour", () => {
    expect(errorsFor({ primary: "red" }).primary).toBeTruthy();
    expect(errorsFor({ primary: "#fff;}body{x:y" }).primary).toBeTruthy();
    expect(errorsFor({ primary: "#abc" })).toEqual({});
    expect(errorsFor({ radius: "huge" as never }).radius).toBeTruthy();
    expect(errorsFor({ fontFamily: "Comic Sans" as never }).fontFamily).toBeTruthy();
    expect(errorsFor({ fontFamily: 'x";}' as never }).fontFamily).toBeTruthy();
    expect(errorsFor({ avatarStyle: "cameo" as never }).avatarStyle).toBeTruthy();
    for (const r of RADIUS_OPTIONS) expect(errorsFor({ radius: r })).toEqual({});
    for (const f of FONT_OPTIONS) expect(errorsFor({ fontFamily: f })).toEqual({});
    for (const a of AVATAR_STYLES) expect(errorsFor({ avatarStyle: a })).toEqual({});
  });

  it("needs a sender address when a Resend key is given, and the key must look like one", () => {
    expect(errorsFor({ resendApiKey: "re_abc123" }).resendFrom).toBeTruthy();
    expect(errorsFor({ resendApiKey: "re_abc123", resendFrom: "hello@school.org" })).toEqual({});
    expect(errorsFor({ resendApiKey: "sk_live_abc", resendFrom: "hello@school.org" }).resendApiKey).toMatch(/re_/);
    expect(errorsFor({ resendFrom: "nope" }).resendFrom).toBeTruthy();
  });

  it("reports the cross-field rules even when other fields are wrong too", () => {
    const e = errorsFor({ username: "admin", password: "x", primary: "red", resendApiKey: "nope" });
    expect(Object.keys(e).sort()).toEqual(["password", "primary", "resendApiKey", "resendFrom", "username"]);
  });

  it("reports one message per field", () => {
    const e = errorsFor({ firstName: "", lastName: "", password: "x" });
    expect(Object.keys(e).sort()).toEqual(["firstName", "lastName", "password"]);
  });
});

describe("STEP_FIELDS", () => {
  it("covers every form field exactly once", () => {
    const all = Object.values(STEP_FIELDS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(valid).sort().concat(["klipyApiKey", "resendApiKey", "resendFrom"]).sort());
  });
});
