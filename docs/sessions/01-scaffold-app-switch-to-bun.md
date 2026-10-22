# 01. Scaffold app, switch to bun (2026-10-22)
- Branch / PR: chore/scaffold-app, PR pending owner merge
- Done: package manager changed from the earlier choice to bun (guard hook, CLAUDE.md, PRD decision 15). Scaffolded Next.js 16.4.2 + React 19.3.1 + OpenNext Cloudflare 1.20.13 + Wrangler 4.151.3, TypeScript 5.9.3 strict, ESLint 9, Vitest 4.1.12. Home page reads D1 and R2 bindings.
- Tests: typecheck and lint pass. `bun run build:cf` builds the Worker. `opennextjs-cloudflare preview` served the page and showed "D1 binding: ok" and "R2 binding: ok" (spike 1 passes for a server component plus D1/R2 bindings). No tests exist yet (`passWithNoTests` is on until the first test lands). Not yet checked: server actions, Edge middleware, Worker bundle size, deploy.
- Decisions: `build` is `next build` and `build:cf` is the OpenNext build (pointing `build` at OpenNext recurses). TypeScript pinned to 5.9.3 and ESLint to 9.39.5 for peer compatibility; vitest 4.1.12 because `@cloudflare/vitest-pool-workers` 0.23 needs vitest 4.1. The `taste` design skill covers landing pages, not product UI, so app screens use `impeccable`.
- Open: `unrs-resolver` postinstall is blocked by bun (not needed so far). The Cloudflare account is shared with other projects; prefix every resource with `netmate-`.
- Next: spikes 2 (Better Auth on D1) and 3 (D1 SQL + FTS5), then migrations and CI.
