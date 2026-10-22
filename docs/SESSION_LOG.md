# Session log

Append-only. One entry per session, newest last. Read only the last 2 entries at the start of a session. Format is in `.claude/skills/log-session/SKILL.md`.

## 00. Planning (2026-10-22)
- Branch / PR: none (no repo yet)
- Done: read the first-idea PRD (`docs/NETMATE-PRD.md`, reference only). Decided the product is an open-source, self-hostable, Cloudflare-only, invite-only microblog with per-instance branding, first-run `/setup`, admin panel `/hq`, Resend + React Email. Drafted `docs/NETMATE-PRD-v2.md`. Rewrote `CLAUDE.md` for Netmate and added the guard hook and the `ship` and `log-session` skills.
- Tests: none yet.
- Decisions: Cloudflare only; `/hq` v1 = branding, approvals, invites, email; invites A (admin link unlimited, each member link auto-approves first 5, then admin approval); AGPL-3.0; greenfield, nothing from `netmate.vercel.app`; pnpm; single app (not a monorepo) pending the PRD.
- Open: write `docs/PRD.md` as the single source of truth from `NETMATE-PRD-v2.md`; answer the open decisions (SETUP_TOKEN, media domain, DCO vs CLA, font hosting, demo instance, default name/logo, repo layout, search, Turnstile); create `docs/ARCHITECTURE.md`, `DESIGN.md`.
- Next: write `docs/PRD.md`, then plan phase 0 spikes.

## 01. Scaffold app, switch to bun (2026-10-22)
- Branch / PR: chore/scaffold-app, PR pending owner merge
- Done: package manager changed from the earlier choice to bun (guard hook, CLAUDE.md, PRD decision 15). Scaffolded Next.js 16.4.2 + React 19.3.1 + OpenNext Cloudflare 1.20.13 + Wrangler 4.151.3, TypeScript 5.9.3 strict, ESLint 9, Vitest 4.1.12. Home page reads D1 and R2 bindings.
- Tests: typecheck and lint pass. `bun run build:cf` builds the Worker. `opennextjs-cloudflare preview` served the page and showed "D1 binding: ok" and "R2 binding: ok" (spike 1 passes for a server component plus D1/R2 bindings). No tests exist yet (`passWithNoTests` is on until the first test lands). Not yet checked: server actions, Edge middleware, Worker bundle size, deploy.
- Decisions: `build` is `next build` and `build:cf` is the OpenNext build (pointing `build` at OpenNext recurses). TypeScript pinned to 5.9.3 and ESLint to 9.39.5 for peer compatibility; vitest 4.1.12 because `@cloudflare/vitest-pool-workers` 0.23 needs vitest 4.1. The `taste` design skill covers landing pages, not product UI, so app screens use `impeccable`.
- Open: `unrs-resolver` postinstall is blocked by bun (not needed so far). The Cloudflare account is shared with other projects; prefix every resource with `netmate-`.
- Next: spikes 2 (Better Auth on D1) and 3 (D1 SQL + FTS5), then migrations and CI.

## 02. Tests and GitHub Actions CI/CD (2026-10-22)
- Branch / PR: chore/ci-tests, stacked on chore/scaffold-app (PR #2)
- Done: Vitest projects `unit` (Node) and `int` (Workers runtime via `@cloudflare/vitest-plugin`, which replaces the deprecated pool-workers package), Playwright phone-width smoke test, first real code with tests (`src/lib/username.ts`). `.github/workflows/ci.yml`: DCO, typecheck+lint+unit+int, OpenNext build, e2e, audit, gitleaks, then deploy on push to main (ensure netmate-* resources, migrations, deploy, smoke test). `.env` (gitignored) and `.env.example`.
- Tests: local typecheck, lint, 6 unit, 10 integration, 1 e2e pass. Integration tests also answer part of spike 3 on local D1: batch rollback, ln/pow, window functions, insert or ignore, recursive queries, foreign key cascades, FTS5 with accent-insensitive prefix match and triggers. Remote D1 is still unconfirmed.
- Decisions: `glob` overridden to 10.5.0 to clear an advisory. One advisory (braces, GHSA-vfj7-8cjw-p6xm) has no patched release and reaches us only through the ESLint plugin, so the CI audit ignores that single id (comment in ci.yml says to remove it once fixed). Vitest config is `.mts` (the repo is CommonJS by default).
- Open: owner must put `CLOUDFLARE_API_TOKEN` in `.env` and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets before the deploy job can pass. No a11y or theme tests yet (no UI to test).
- Next: watch CI on the PR, merge order #2 then this one, then spikes 2 and 3 on remote D1.

## 04. Spike 2: Better Auth on D1 (2026-10-22)
- Branch / PR: chore/spike-better-auth
- Done: added better-auth 1.7.12, drizzle-orm 0.45.4, drizzle-kit 0.31.11. Generated the auth schema with `bunx auth@1.7.12 generate` (SQLite, text ids, ms timestamps) into `src/db/auth-schema.ts`, migration `migrations/0000_auth_tables.sql`, `createAuth(env)` factory in `src/auth/index.ts` (UUID ids, IP tracking off, 8 to 128 password length, no transactions). Vitest `int` project now applies the real migrations before each file. `db:generate`, `db:migrate:local`, `db:check` scripts.
- Tests: 6 new integration tests (sign-up, duplicate email, sign-in + session, wrong password, password length, cascade delete). Local: 16 integration tests pass, typecheck and lint pass. Hashing about 110 ms (sign-in) to 280 ms (cold sign-up) in local workerd.
- Decisions: the Better Auth CLI is the `auth` package at the same version as `better-auth`, run with `bunx auth@1.7.12`; `@better-auth/cli` is stale (1.4.x) and not used.
- Open: the first remote migration happens in the deploy job after merge (needs SQLite 3.42+ for `unixepoch('subsecond')`; if it fails the migration rolls back and deploy stops, fix on a new branch). Sign-up is not atomic without transactions (PRD R5). No auth route or `/setup` yet (phase 2). `AUTH_SECRET` is not set in production yet.
- Next: spike 3 on remote D1, then schema (instance, profiles, invites) and the theme tokens.
