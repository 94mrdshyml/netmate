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
