import { defineConfig, devices } from "@playwright/test";

const port = 8788;

// The preview runs the built Worker on a local D1, which starts empty, so the real
// migrations are applied first. Set E2E_SKIP_BUILD=1 to reuse an existing .open-next build.
const steps = [
  "bun run db:migrate:local",
  ...(process.env.E2E_SKIP_BUILD ? [] : ["bunx opennextjs-cloudflare build"]),
  `bunx opennextjs-cloudflare preview --port ${port}`,
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
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // Phone first: every test runs at phone width.
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: steps.join(" && "),
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
