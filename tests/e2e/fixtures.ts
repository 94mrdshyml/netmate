import { expect, test as base } from "@playwright/test";

// Every spec imports `test` and `expect` from here instead of from Playwright. The one difference: each test
// counts its own posts apart from every other test's. The suite shares one admin, and the site allows 10 posts a
// minute per person, so without this the suite slept a full minute whenever a test came after a burst of posts
// (four times a run, over four minutes). The server honours the cookie only when it was started with ENV exactly
// "test" (see `postSubject` in src/server/rate-limit.ts), so the real limit is still the real limit, and it is
// tested directly by the integration tests. Specs about rate limits (rate-limit.spec.ts) use Playwright's own
// `test` and never set the cookie.
export const test = base.extend({
  context: async ({ context, baseURL }, provide, testInfo) => {
    if (baseURL) await context.addCookies([{ name: "e2e_scope", value: testInfo.testId, url: baseURL }]);
    await provide(context);
  },
});

export { expect };
