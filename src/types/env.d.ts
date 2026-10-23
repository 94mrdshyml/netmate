// Secrets are not in wrangler.jsonc, so `wrangler types` does not know them. Declared here;
// set them with .dev.vars locally and as Worker secrets in production. docs/PRD.md section 12.
interface CloudflareEnv {
  AUTH_SECRET: string;
  SETUP_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  BETTER_AUTH_URL?: string;
  /** "test" only in tests: email goes to an in-memory outbox instead of Resend. */
  ENV?: string;
}

declare namespace Cloudflare {
  interface Env {
    AUTH_SECRET: string;
    SETUP_TOKEN?: string;
    SETTINGS_ENCRYPTION_KEY?: string;
    BETTER_AUTH_URL?: string;
    ENV?: string;
  }
}
