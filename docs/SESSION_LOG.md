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
- Outcome: merged as PR #4 (the stacked PR #3 had merged into the scaffold branch after #2, so #4 carried it to main). First deploy to Cloudflare worked: https://netmate.mridu.workers.dev reports D1 and R2 ok; `netmate-db` and `netmate-media` created. Lesson: do not stack PRs; `gh run watch` and run-level status can lie, poll job statuses.

## 03. Open-source foundation (2026-10-22)
- Branch / PR: chore/oss-foundation
- Done: AGPL-3.0 `LICENSE`, `README`, `CONTRIBUTING` (DCO), Contributor Covenant 2.1 `CODE_OF_CONDUCT` (contact = private report via the Security tab / owner's GitHub profile), `SECURITY`, `TRADEMARK`, issue and PR templates, `CODEOWNERS`, Dependabot (bun + actions), release-please workflow and config (starts at 0.0.0, pre-1.0 minor bumps), PR-title check for Conventional Commits. DCO script now skips release-please and dependabot branches (bots cannot sign off). `package.json` repository fields.
- Tests: lint and typecheck pass; CI result in the PR.
- Decisions: none new.
- Open: owner enables branch protection on `main` (PR, green checks, squash only, no force-push) and, in Settings > Actions > General, allows Actions to create PRs for release-please. GitHub Actions PRs made with the default token do not trigger CI; if release PRs need checks, add a PAT later. The deploy button only works once the repo is public. Enable private vulnerability reporting in Security settings.
- Next: spike 2 (Better Auth on D1).

## 04. Spike 2: Better Auth on D1 (2026-10-22)
- Branch / PR: chore/spike-better-auth
- Done: added better-auth 1.7.12, drizzle-orm 0.45.4, drizzle-kit 0.31.11. Generated the auth schema with `bunx auth@1.7.12 generate` (SQLite, text ids, ms timestamps) into `src/db/auth-schema.ts`, migration `migrations/0000_auth_tables.sql`, `createAuth(env)` factory in `src/auth/index.ts` (UUID ids, IP tracking off, 8 to 128 password length, no transactions). Vitest `int` project now applies the real migrations before each file. `db:generate`, `db:migrate:local`, `db:check` scripts.
- Tests: 6 new integration tests (sign-up, duplicate email, sign-in + session, wrong password, password length, cascade delete). Local: 16 integration tests pass, typecheck and lint pass. Hashing about 110 ms (sign-in) to 280 ms (cold sign-up) in local workerd.
- Decisions: the Better Auth CLI is the `auth` package at the same version as `better-auth`, run with `bunx auth@1.7.12`; `@better-auth/cli` is stale (1.4.x) and not used.
- Open: the first remote migration happens in the deploy job after merge (needs SQLite 3.42+ for `unixepoch('subsecond')`; if it fails the migration rolls back and deploy stops, fix on a new branch). Sign-up is not atomic without transactions (PRD R5). No auth route or `/setup` yet (phase 2). `AUTH_SECRET` is not set in production yet.
- Next: spike 3 on remote D1, then schema (instance, profiles, invites) and the theme tokens.
- Outcome: merged as PR #6. The auth migration applied on remote D1 (no SQLite version problem) and the deploy succeeded; the live site still reports D1 and R2 ok.

## 05. Release workflow fix and Dependabot noise (2026-10-22)
- Branch / PR: chore/dependabot-config (#16, merged), ci/release-please-v4 (this change)
- Done: Dependabot opened 9 PRs after #5 merged (3 pinned majors, 6 Actions); #16 stops app majors and groups Actions; the 9 bot PRs were closed. The Release workflow failed on every merge since #6: first because "Allow GitHub Actions to create and approve pull requests" was off (owner enabled it), then with a GitHub GraphQL "Something went wrong while executing your query" error that survived a retry, a v4 downgrade and a config change. Root cause found by reproducing release-please's history query with `gh api graphql` and bisecting by offset: four old commits on `main` (31b0cdc and three more) belong to two merged PRs (#3 and #4, the mistaken stacked PR), and GitHub errors on their `associatedPullRequests`. With no earlier release, release-please walks all history in pages of 10 and hits them on page 2. Fix: `bootstrap-sha` set to the merge of #17 (def8b67) so the walk stops on page 1; added `workflow_dispatch`; kept release-please-action at v5 (the version was not the cause).
- Tests: the first page of history queries cleanly (10 commits). The fix can only be proven on `main` because release-please reads config from `main`; after merge, run the Release workflow manually and check it.
- Decisions: do not stack PRs again. Do not move `bootstrap-sha` older.
- Open: after merge, confirm the Release run is green. No release PR is expected yet (no `feat`/`fix` commits after the bootstrap commit); when one appears, do not merge it until we want a release. PR #17 bumped checkout/setup-node/upload-artifact to v7 and CI stayed green.
- Next: Stripe-style ids, then spike 3 on remote D1.

## 06. Stripe-style ids (2026-10-22)
- Branch / PR: feat/prefixed-ids
- Done: ids are now `{prefix}_{24 base62 chars}` (`usr_`, `sess_`, `acc_`, `ver_`) instead of UUIDs. New `src/lib/ids.ts` (`newId`, `randomId` with rejection sampling so every character is equally likely, `isId`, `ID_PREFIXES`). Better Auth `generateId` uses it and throws for a model with no prefix. PRD section 10 and decision 16, and the IDs line in CLAUDE.md, updated.
- Tests: 8 new unit tests (format, no `_` or `-` in the random part, 20,000 ids with no repeat, even spread over all 62 characters, per-model validation). Auth integration tests now assert `usr_`, `acc_` and `sess_` ids. A real bug was caught by the even-spread test: `crypto.getRandomValues` accepts at most 65,536 bytes per call; `randomId` now chunks. Local: typecheck, lint, 14 unit and 16 integration tests pass.
- Decisions: ids are random, not time-ordered, so ordering uses the time column and cursors stay `(milliseconds, id)`. Invite link codes will be a separate longer random value, not an id. No data migration needed: no users exist yet.
- Open: none.
- Next: spike 3 on remote D1, then the schema (instance, profiles, invites) and theme tokens.
