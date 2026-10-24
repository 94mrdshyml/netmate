import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// scripts/ci/changes.sh decides which CI jobs a push needs. Skipping a check wrongly is the worst thing it could
// do, so every doubt must come out as "run everything". These tests run the real script in a throwaway git repo.

const SCRIPT = resolve(__dirname, "../../scripts/ci/changes.sh");
const ZERO = "0".repeat(40);
let dir = "";

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();

function commit(files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "change");
  return git("rev-parse", "HEAD");
}

function decide(env: { before: string; head: string; ref?: string; event?: string }) {
  const out = execFileSync("bash", [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, BEFORE: env.before, HEAD_SHA: env.head, REF: env.ref ?? "refs/heads/feat/x", EVENT: env.event ?? "push" },
  });
  return Object.fromEntries(out.trim().split("\n").map((line) => line.split("=")));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-changes-"));
  git("init", "-q", "-b", "main");
  commit({ "src/app.ts": "export {};\n", "README.md": "# hi\n" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("what a push needs from CI", () => {
  it("runs nothing slow when only documentation changed", () => {
    const before = git("rev-parse", "HEAD");
    const head = commit({ "docs/sessions/50-x.md": "log\n", "DESIGN.md": "notes\n", "docs/PRD.md": "spec\n" });
    expect(decide({ before, head })).toEqual({ code: "false", heavy: "false" });
  });

  it("runs everything when any code file changed, even beside documentation", () => {
    const before = git("rev-parse", "HEAD");
    const head = commit({ "docs/PRD.md": "more\n", "src/app.ts": "export const a = 1;\n" });
    expect(decide({ before, head })).toEqual({ code: "true", heavy: "true" });
  });

  it("treats the workflow, scripts, tests, migrations, config and paths with brackets as code", () => {
    for (const path of [".github/workflows/ci.yml", "scripts/ci/changes.sh", "tests/e2e/a.spec.ts", "migrations/0099_x.sql", "package.json", "app/(app)/(member)/page.tsx", "bun.lock", "wrangler.jsonc"]) {
      const before = git("rev-parse", "HEAD");
      const head = commit({ [path]: `${Math.random()}\n` });
      expect(decide({ before, head }), path).toEqual({ code: "true", heavy: "true" });
    }
  });

  it("after a merge to main, still builds and deploys code, but does not run the slow checks again", () => {
    const before = git("rev-parse", "HEAD");
    const head = commit({ "src/app.ts": "export const b = 2;\n" });
    expect(decide({ before, head, ref: "refs/heads/main" })).toEqual({ code: "true", heavy: "false" });
  });

  it("does not deploy a merge to main that changed only documentation", () => {
    const before = git("rev-parse", "HEAD");
    const head = commit({ "docs/PRD.md": "again\n" });
    expect(decide({ before, head, ref: "refs/heads/main" })).toEqual({ code: "false", heavy: "false" });
  });

  it("runs everything for a manual run", () => {
    const head = git("rev-parse", "HEAD");
    expect(decide({ before: "", head, event: "workflow_dispatch", ref: "refs/heads/main" })).toEqual({ code: "true", heavy: "true" });
  });

  it("runs everything when it cannot tell what changed", () => {
    const head = git("rev-parse", "HEAD");
    // A commit that does not exist, and the first push of a branch with no main to compare with.
    expect(decide({ before: "1234567890123456789012345678901234567890", head })).toEqual({ code: "true", heavy: "true" });
    expect(decide({ before: ZERO, head })).toEqual({ code: "true", heavy: "true" });
    expect(decide({ before: "", head })).toEqual({ code: "true", heavy: "true" });
    // Nothing changed in the range (an empty list of files) is also not a reason to skip.
    expect(decide({ before: head, head })).toEqual({ code: "true", heavy: "true" });
  });
});
