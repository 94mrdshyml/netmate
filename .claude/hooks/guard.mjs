#!/usr/bin/env node
// PreToolUse guard for Bash. Enforces CLAUDE.md hard rule 1 (production is CI-only).
// Exit 2 blocks the command and shows stderr to the agent.
import { readFileSync } from "node:fs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (input.tool_name !== "Bash") process.exit(0);
const cmd = String(input.tool_input?.command ?? "");

const rules = [
  {
    test: (c) => /\bwrangler\b[^|;&]*\bdeploy\b/.test(c) && !/--dry-run/.test(c),
    why: "wrangler deploy is CI-only (use --dry-run to check).",
  },
  {
    test: (c) => /\bwrangler\b[^|;&]*--remote\b/.test(c),
    why: "wrangler --remote touches production. CI only.",
  },
  {
    test: (c) => /\bwrangler\b[^|;&]*\bsecret\b/.test(c),
    why: "wrangler secret is set by a human, never by an agent.",
  },
  {
    test: (c) => /\bwrangler\b[^|;&]*\brollback\b/.test(c),
    why: "wrangler rollback is a human decision.",
  },
  {
    test: (c) => /\bdrizzle-kit\b[^|;&]*\bpush\b/.test(c),
    why: "drizzle-kit push bypasses migrations. Use db:generate and read the SQL.",
  },
  {
    test: (c) => /\bgit\b[^|;&]*\bpush\b[^|;&]*(--force|--force-with-lease|\s-f\b)/.test(c),
    why: "Force-push is not allowed.",
  },
  {
    // Pushing to main is allowed only after the owner confirms in the permission prompt.
    ask: true,
    test: (c) => /\bgit\b[^|;&]*\bpush\b[^|;&]*\b(origin\s+)?(HEAD:)?(refs\/heads\/)?main\b/.test(c),
    why: "Push to main needs the owner's approval. Features and fixes go through a branch and a PR.",
  },
  {
    test: (c) => /\bgh\s+pr\s+merge\b/.test(c),
    why: "The owner merges PRs. Never merge by hand or with --auto.",
  },
  {
    test: (c) => /--no-verify\b/.test(c) || /--no-gpg-sign\b/.test(c),
    why: "Never skip hooks or signing.",
  },
  {
    test: (c) => /\bnpm\s+(i|install|ci|run)\b|\byarn\b|\bbun\s+(i|install|add|run)\b/.test(c),
    why: "pnpm only. Never npm, yarn or bun.",
  },
];

for (const r of rules) {
  if (r.test(cmd)) {
    if (r.ask) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: r.why,
          },
        }),
      );
      process.exit(0);
    }
    process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${r.why} Ask the user.\n`);
    process.exit(2);
  }
}
process.exit(0);
