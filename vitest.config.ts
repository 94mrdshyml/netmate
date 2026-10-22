import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    passWithNoTests: true,
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
