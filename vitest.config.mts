import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
              d1Databases: ["DB"],
              r2Buckets: ["MEDIA"],
              bindings: {
                TEST_MIGRATIONS: migrations,
                AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
                SETUP_TOKEN: "test-setup-token-0123456789-abcdefghij",
                SETTINGS_ENCRYPTION_KEY: "test-encryption-key-0123456789-abcdefgh",
              },
            },
          }),
        ],
        test: {
          name: "int",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
