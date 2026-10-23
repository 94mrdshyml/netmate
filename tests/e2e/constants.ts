import { randomBytes } from "node:crypto";

// Values for the e2e preview, which runs against a throwaway local database.
// The keys are random on every run and shared with the test workers through the environment,
// so no key-shaped value is ever committed (and the secret scanner stays strict).
function perRun(name: string): string {
  process.env[name] ??= randomBytes(32).toString("base64url");
  return process.env[name] as string;
}

export const E2E = {
  port: 8788,
  persistDir: ".wrangler/e2e-state",
  setupToken: perRun("E2E_SETUP_TOKEN"),
  authSecret: perRun("E2E_AUTH_SECRET"),
  encryptionKey: perRun("E2E_ENCRYPTION_KEY"),
  authFile: "tests/e2e/.auth/admin.json",
  admin: {
    firstName: "Riya",
    lastName: "Sen",
    email: "riya@example.com",
    username: "riya_sen",
    password: "correct horse battery",
  },
  instance: { name: "E2E Valley", primary: "#0B6E4F" },
} as const;
