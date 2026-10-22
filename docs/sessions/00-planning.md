# 00. Planning (2026-10-22)
- Branch / PR: none (no repo yet)
- Done: read the first-idea PRD (`docs/NETMATE-PRD.md`, reference only). Decided the product is an open-source, self-hostable, Cloudflare-only, invite-only microblog with per-instance branding, first-run `/setup`, admin panel `/hq`, Resend + React Email. Drafted `docs/NETMATE-PRD-v2.md`. Rewrote `CLAUDE.md` for Netmate and added the guard hook and the `ship` and `log-session` skills.
- Tests: none yet.
- Decisions: Cloudflare only; `/hq` v1 = branding, approvals, invites, email; invites A (admin link unlimited, each member link auto-approves first 5, then admin approval); AGPL-3.0; greenfield, nothing from `netmate.vercel.app`; pnpm; single app (not a monorepo) pending the PRD.
- Open: write `docs/PRD.md` as the single source of truth from `NETMATE-PRD-v2.md`; answer the open decisions (SETUP_TOKEN, media domain, DCO vs CLA, font hosting, demo instance, default name/logo, repo layout, search, Turnstile); create `docs/ARCHITECTURE.md`, `DESIGN.md`.
- Next: write `docs/PRD.md`, then plan phase 0 spikes.
