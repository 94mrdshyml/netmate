# Netmate

Open-source, self-hostable, Twitter/X-style microblog for a private community (family and friends, a school, an organisation). One deployment = one instance, with its own members, data and brand. Invite-only. Mobile-first. Runs on Cloudflare only. Licence: AGPL-3.0.

Instance owners customise name, logo, favicon, primary colour, corner radius, font and default avatar style. If a change hard-codes brand, or weakens a privacy promise, it is a bug.

## Source of truth

Order of authority: **this file > session prompt > docs/PRD.md > docs/ARCHITECTURE.md > DESIGN.md.**
If a session prompt or another doc conflicts with this file, follow this file, point out the conflict and ask. If a decision in any doc looks wrong, say so and stop. Do not change it on your own.

Read only what the task needs:
- Product or feature scope → `docs/PRD.md` (the full spec; every feature rule and number lives there)
- Data flow, bindings, schema, deploy → `docs/ARCHITECTURE.md`
- Any UI work → `DESIGN.md` in the project root (not written yet; until it exists, UI follows the PRD's design rules in section 8.13)
- Design skills: the app is **product UI**, so use the `impeccable` skill for app screens. The `design-taste-frontend` ("taste") skill is installed at user level and explicitly covers landing pages, portfolios and redesigns, not product UI; use it only for marketing pages, the README site or the demo landing page
- Why a v1 rule exists (feed scoring, `visibleTo`, analytics) → `docs/NETMATE-PRD.md` (old first-idea spec, **reference only**: nothing from `netmate.vercel.app`, no data, code, assets or brand, is reused)
- Start of every session → the last 2 entries of `docs/SESSION_LOG.md` only

## Stack

Versions are pinned in `package.json`. Do not upgrade a major version without asking.

- **Language:** TypeScript (strict) everywhere
- **Package manager and script runner:** **bun only** (`bun install`, `bun run`, `bunx`), never npm, npx, yarn or pnpm. The lockfile is `bun.lock`. Code still runs on Workers, not on Bun
- **App:** Next.js 16 (App Router, Server Components, Server Actions) built for Workers with `@opennextjs/cloudflare`
- **Runtime:** Cloudflare Workers + D1 (`DB`) + R2 (`MEDIA`) + Workers Rate Limiting (`LIMITER`) + Cron Triggers. Workers Paid is the minimum plan. No other host, no Node-only APIs
- **Database:** D1 (SQLite) with Drizzle ORM (SQLite driver) and Wrangler migrations
- **Auth:** Better Auth, run by us inside the app, data in D1, email and password
- **Email:** Resend + React Email. Templates take branding from instance settings
- **Default avatars:** DiceBear, generated inside the app, no outside request
- **Validation:** Zod on every request body, query and form
- **Tests:** Vitest (unit, and Workers integration with `@cloudflare/vitest-pool-workers`), Playwright (browser + end to end, phone width), axe-core
- **Icons:** Feather only
- **CI/CD:** GitHub Actions and Wrangler. Releases are cut by hand with the Release workflow

Layers: pages → actions → `src/server` → `src/db`. Pages and actions never write SQL.

## Repo map

Single app (not a monorepo) until the PRD says otherwise.

```
app/              Next.js routes (member pages mobile-width; /hq wide; /setup mobile-width)
src/
  server/         domain logic: posts, feed, follows, visibility, invites, analytics, notifications
  db/             Drizzle schema, queries, getDb(), batch helpers
  auth/           Better Auth config, roles, session helpers
  instance/       instance settings read/cache/save, setup state, theme token derivation
  email/          React Email templates, Resend client, outbox for tests
  storage/        R2 helpers, upload validation
  lib/            shared pure helpers (text parsing, cursors, contrast, limits)
migrations/       D1 migrations (generated, then READ)
scripts/          dev and test helpers (seed is DEV/TEST ONLY)
tests/            unit/  integration/  e2e/  email/  a11y/  theme/
docs/             PRD, ARCHITECTURE, SESSION_LOG, NETMATE-PRD (old reference)
.github/          workflows, issue and PR templates, CODEOWNERS
wrangler.jsonc    bindings, cron, vars
DESIGN.md         design system (root)
```

## Commands

If a script below is missing from `package.json`, add it in the same change.

```
bun install                          # CI uses --frozen-lockfile
bun run dev                          # next dev with local D1 and R2
bun run preview                      # OpenNext build run in the Workers runtime
bun run typecheck && bun run lint
bun run test                         # unit tests (Vitest; never plain `bun test`)
bunx vitest run path/to/file.test.ts # one test file: prefer this while working
bun run test:int                     # Workers integration against local D1
bun run test:email                   # email templates render with a sample brand
bun run test:e2e                     # Playwright journeys at phone width
bun run test:a11y                    # axe on key screens, light and dark, extreme brand colours
bun run test:theme                   # radius / colour / font matrix
bun run db:generate                  # drizzle-kit generate. Then READ the SQL
bun run db:migrate:local             # wrangler d1 migrations apply --local
bun run db:check                     # schema matches migrations
bun run db:seed                      # local/test data only, refuses a configured production instance
bun run build                        # next build (OpenNext calls this; never point it at OpenNext)
bun run build:cf                     # OpenNext build for Workers
```

Local secrets live in `.dev.vars` (gitignored). Production secrets are set by a human, never by an agent.

## Hard rules

IMPORTANT: these are also enforced by `.claude/hooks/guard.mjs` and CI. Do not try to work around a block. Ask.

1. **Production is CI-only.** Never run `wrangler deploy` (except `--dry-run`), any `wrangler … --remote`, `wrangler secret`, `wrangler rollback`, `wrangler d1 execute --remote` or `drizzle-kit push`. Never force-push. Never push to `main` without the owner's approval (the guard asks; the first commit was the only planned exception). Never merge a PR: the owner merges every PR. Every feature or fix is its own branch and its own PR, opened with the `ship` skill once tests are done.
2. **Privacy promises.**
   - Analytics is owner-only and counts-only. No query, page or email ever names who viewed someone.
   - Bookmarks are private. Nobody sees a bookmark count on a post.
   - Never store, log or forward a visitor IP address except as a rate-limit key that expires. Never log emails, passwords, tokens, API keys or reset links.
   - Readers' browsers make no request to third parties by default. Fonts, avatars and icons are self-hosted. Only GIF search (if enabled) and link-preview pictures reach outside.
3. **Setup and admin.**
   - `/setup` is one-time and atomic: admin, settings and the configured flag are written together or not at all. Once configured it returns 404 for ever. It requires `SETUP_TOKEN` when that decision is on.
   - `/hq` and its actions check the admin role on the server every time. A non-admin gets 404, not 403.
   - Secrets (Resend key, Klipy key) are encrypted in D1 with `SETTINGS_ENCRYPTION_KEY`, are never returned to the browser, and are never logged.
4. **One visibility rule.** `visibleTo` decides who sees what. Every list of posts, the post page, replies, quotes, bookmarks, the feed, search, notifications and analytics recording use it. Never re-implement it.
5. **Every server action checks the session itself.** Never trust a user id from the client.
6. **No hard-coded brand.** No fixed name, logo, colour, font or avatar style in UI, titles, share text or emails. Everything reads instance settings and CSS variables.
7. **Test integrity.** Never skip, delete or weaken a test, lower a size or coverage limit, update snapshots or golden files, loosen lint rules, or add `continue-on-error` without explicit approval in the session prompt.
8. **Secrets.** Never commit secrets. `.dev.vars` and `.env*` stay gitignored.

## Architecture invariants

- Mobile column everywhere (max 480px, centred) except `/hq`, which is the only wide layout. `/setup`, sign-in and sign-up are mobile-width.
- Sign-up is invite-only. The admin link is unlimited. Each member link auto-approves the first N sign-ups (N is an instance setting, default 5, counted ever, never freed). Later sign-ups become Pending and need admin approval. The quota check and status are decided in one atomic database step.
- Actions are idempotent: send the state wanted ("liked"), not a flip.
- A counter on a post changes in the same `db.batch()` as the row that causes it.
- The instance "configured?" check is a cheap cached read, runs on every request, and never goes back to false.
- Instance settings become CSS variables on the page, so a change in `/hq` needs no redeploy. Saving clears the cache.
- Primary colour: derive text-on-primary, hover and pressed shades, and a dark variant. Refuse or adjust any colour that cannot reach WCAG AA in both themes.
- Uploads go through the Worker (`/api/upload`): session, rate limit, type, size and first-byte sniff checked before writing to R2. A stored file is checked again before it is attached.
- Post text is always rendered as text. Mentions, tags and links are found by parsing, never by injecting HTML. Theme values (colour, font name) are validated so they cannot inject CSS or script.
- Migrations are forward-only and safe to run on an instance at any older version (expand, then contract across releases). CI checks upgrade from the previous release.
- Email degrades gracefully with no Resend key: verification skipped, "forgot password" hidden, invite links shared by hand, `/hq` shows a banner.
- Seed and fake data exist only for local development and tests.

## Conventions

- **IDs:** Stripe-style, `{prefix}_{24 base62 chars}` such as `usr_3kT9xQ0mYb7LpA2vNc8RzEd1`, made only by `newId()` in `src/lib/ids.ts` (never `crypto.randomUUID()`). Add the prefix to `ID_PREFIXES` in the same change that adds a table, and to the table in `docs/PRD.md` section 10. Better Auth gets its ids from the same function and throws for a model with no prefix. Times are integer milliseconds UTC. Yes/no is 0/1. Enums are text with a check. Feed cursors are `(milliseconds, id)`.
- **Roles:** Admin (one at setup), Member, Pending (cannot sign in). Another member's private resource returns 404, never 403.
- **Validation:** Zod at every boundary. Verify webhook signatures and make handlers idempotent.
- **Error handling:** handle failures at every I/O boundary (D1, R2, Resend, fetch). Skip handling only for truly impossible states.
- **UI:** follow `DESIGN.md`. Flat, no shadows or gradients. One brand colour, used sparingly. Feather icons only. No emoji and no em dashes in interface text. Tap targets at least 44px, safe areas respected. Plain-English copy. Zeros show as zeros, "new" is never a percentage.
- **Dependencies:** ask before adding any package.
- **Git:** trunk-based. `main` is protected (PR, green CI, linear history, squash merge). Short-lived branches `feat/…`, `fix/…`, `docs/…`, `chore/…`. Conventional commits, also used for PR titles (GitHub builds release notes from merged PR titles). Sign off commits (`git commit -s`) for the DCO. Never use `--no-verify`.
- **Docs:** if a change alters behaviour, update `docs/PRD.md` in the same PR.

## Gotchas

- D1 has **no interactive transactions**. Use `db.batch()` (atomic) with fixed statement lists and counter changes done in SQL. Anything that reads then writes becomes conditional SQL.
- D1 allows 100 bound values per query and 100 KB per statement: cap `IN (…)` lists and write in small batches.
- Search is FTS5 (`posts_fts`, `profiles_fts`) kept in sync by triggers, results filtered by `visibleTo`. Escape user input before it reaches the index. D1 export does not carry virtual tables: the index must be rebuildable from the normal tables. The `trigram` tokenizer exists on real D1 (spike 3); the search phase decides whether to use it.
- SQLite `LIKE` ignores case only for plain English letters. Lower-case in code for names in other scripts (applies to non-search lookups such as username checks).
- `ln`, `pow`, window functions, recursive queries, FTS5 and `unixepoch('subsecond')` all work on real D1 (spike 3). `sqlite_version()` is not allowed. The For you score is still computed in TypeScript over simple SQL candidates.
- OpenNext does not support Next 16 `proxy.ts` (Node middleware). Use an Edge `middleware.ts` for the cheap setup redirect or check in the root layout. Every page and action still checks the session.
- Never stack PRs (a PR whose base is another feature branch). GitHub's GraphQL `associatedPullRequests` returned internal errors for commits that belong to two merged PRs (#3 and #4), which broke release-please until it was removed. Releases are now manual, but stacked PRs still leave a confusing history. Open every PR against `main`.
- Workers Free will exceed CPU and query limits. Test on Paid.
- No I/O (D1, R2, fetch) at module scope. Use bindings per request.
- Workers cannot pin a resolved DNS address like Node can. The link-preview fetcher needs its own safe design (resolve over DNS-over-HTTPS and refuse private ranges, re-check every redirect), or the feature stays off.
- The Rate Limiting binding is approximate and counts per location. Use it only for high-volume limits (likes, events). Sign-in, sign-up, password and invite limits use the exact D1 table.
- KV and caches can lag. Never use them for auth or permission decisions.
- Mail apps do not render SVG logos. Email uses a PNG logo from the public media domain, falling back to the instance name as text.
- Only open-licence (OFL) Google fonts. The font file is fetched once at save time and served from R2.
- Better Auth hashing time must fit the Worker CPU limit (spike 2). Reuse of Neon Auth hashes is irrelevant: nothing is migrated.
- Resend sender address must be on a domain verified in Resend. Show Resend's error text in `/hq`.
- Tests never call Resend. The fake outbox runs only when `ENV=test`, and a test proves production cannot use it.
- Losing `SETTINGS_ENCRYPTION_KEY` means re-entering stored keys, not losing data. Document it.

## How a session runs

1. Read the last 2 entries of `docs/SESSION_LOG.md` and run `git status`. Create a branch from an up-to-date `main`.
2. State a short plan with a check for each step (`[step] → verify: [check]`). If the prompt has two readings, ask.
3. Implement. Read every file before editing it. Make the smallest change that solves the task, matching existing style. Remove only what your change orphaned, and mention any other dead code you notice. Write tests with the code.
4. Run locally: typecheck, lint, the affected unit tests, plus `test:int` when you touched `src/db` or `src/server`, `test:email` for email, `test:theme` and `test:a11y` for UI or theme.
5. Run the **`ship`** skill: push the branch, open one PR, watch CI, fix (max 3 attempts), then hand the green PR to the owner, who merges it.
6. Run the **`log-session`** skill.

If you break something, say so plainly and fix it in the same session. Use `git diff` when unsure what changed.

## Definition of done

- Typecheck, lint and all affected tests pass locally, and new behaviour has tests.
- Migrations generated, SQL read, forward-only and safe on older instances.
- No hard-coded brand, and extreme brand colours still pass contrast.
- No new dependency without approval. `docs/PRD.md` updated if behaviour changed.
- CI green, or stopped after 3 attempts with a written report.
- Session log entry appended.

## When compacting

Keep: current branch, PR number, CI run ID and its failing jobs, fix attempt count, the list of modified files, and any open questions for the user.
