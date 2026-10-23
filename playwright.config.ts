import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/constants";

// The preview runs the built Worker on a throwaway local D1 that starts empty: reset it,
// apply the real migrations, then start. The values the app needs are passed as local vars.
// Set E2E_SKIP_BUILD=1 to reuse an existing .open-next build.
const vars = [
  `SETUP_TOKEN:${E2E.setupToken}`,
  `AUTH_SECRET:${E2E.authSecret}`,
  `SETTINGS_ENCRYPTION_KEY:${E2E.encryptionKey}`,
  // Email goes to an in-memory outbox and Resend is never called (src/email/transport.ts).
  "ENV:test",
  `BETTER_AUTH_URL:http://localhost:${E2E.port}`,
]
  .map((v) => `--var ${v}`)
  .join(" ");

const steps = [
  "node scripts/e2e-reset.mjs",
  `bunx wrangler d1 migrations apply DB --local --persist-to ${E2E.persistDir}`,
  ...(process.env.E2E_SKIP_BUILD ? [] : ["bunx opennextjs-cloudflare build"]),
  `bunx opennextjs-cloudflare preview --port ${E2E.port} --persist-to ${E2E.persistDir} ${vars}`,
];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Fail fast: a broken page should not make every test wait out its timeouts.
  maxFailures: 3,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${E2E.port}`,
    trace: "retain-on-failure",
  },
  // Phone first: every test runs at phone width. "setup" runs first and creates the admin on
  // the empty instance; everything else then runs signed in on the configured instance.
  projects: [
    { name: "setup", testMatch: /setup\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    {
      name: "phone",
      testIgnore: /setup\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: E2E.authFile },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: steps.join(" && "),
        url: `http://localhost:${E2E.port}/setup`,
        // Always start fresh: a leftover server would hold an old build and old data.
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
