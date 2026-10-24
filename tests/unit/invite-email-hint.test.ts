import { describe, expect, it } from "vitest";
import { emailFromHash, withEmailHint } from "@/lib/invite-email-hint";

describe("the invited address in a link", () => {
  it("goes after the # so it never reaches the server", () => {
    const url = withEmailHint("https://club.example.org/sign-up?invite=abc", "sam@example.com");
    expect(url).toBe("https://club.example.org/sign-up?invite=abc#email=sam%40example.com");
    expect(new URL(url).search).toBe("?invite=abc");
  });

  it("is read back, trimmed and in lower case", () => {
    expect(emailFromHash("#email=sam%40example.com")).toBe("sam@example.com");
    expect(emailFromHash("email=%20Sam%40Example.COM%20")).toBe("sam@example.com");
    expect(emailFromHash(`#email=${encodeURIComponent("sam+club@example.com")}`)).toBe("sam+club@example.com");
  });

  it("is ignored when it is missing or not an address", () => {
    for (const hash of ["", "#", "#email=", "#email=nobody", "#email=a%40b", "#other=sam%40example.com", "#email=%3Cscript%3E%40x.com"]) {
      expect(emailFromHash(hash), hash).toBeNull();
    }
    expect(emailFromHash(`#email=${"a".repeat(250)}%40example.com`)).toBeNull();
  });
});
