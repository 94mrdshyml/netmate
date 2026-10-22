# Netmate

An open-source, self-hostable, Twitter/X-style microblog for a private community: family and friends, a school, or an organisation. One deployment is one instance, with its own members, data, name and look. Invite-only, phone-first, and it runs entirely on Cloudflare.

> **Status: early development (pre-0.1).** The app does not do anything useful yet. Follow progress in [`docs/SESSION_LOG.md`](docs/SESSION_LOG.md) and the roadmap below.

## What it will be

- **Your own, branded.** Set the name, logo, favicon, primary colour, corner radius, font and default avatar style. Emails match.
- **Invite-only.** Every member gets an invite link. Past a quota the admin approves new sign-ups.
- **Mates.** "Followed by Meera and 2 more": see who in your circle knows whom.
- **Owner-only analytics.** Each member sees how their own posts are doing. Counts only, never who.
- **Calm by default.** A ranked "For you" feed, a plain "Following" feed, private accounts, block and mute.
- **Phone first.** One centred phone-width column everywhere except the admin panel (`/hq`).

The full product spec is [`docs/PRD.md`](docs/PRD.md). It is the single source of truth.

## Deploy your own

Netmate runs on Cloudflare Workers with D1 (database) and R2 (files). It needs the **Workers Paid** plan (Free hits CPU and query limits).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/94mrdshyml/netmate)

The button works once this repository is public. After deploying, open your instance URL: the first visit goes to `/setup`, where you create the admin account and choose the look. A complete self-hosting guide (secrets, Resend email, custom domain, backups, upgrading) will live in `docs/` before 0.1.

## Develop

Requirements: [Bun](https://bun.sh) 1.3+, Node 22+, and a Cloudflare account for deploys.

```
bun install
bun run dev            # next dev with local D1 and R2
bun run preview        # build for Workers and run it locally
bun run typecheck && bun run lint
bun run test           # unit tests
bun run test:int       # integration tests in the Workers runtime
bun run test:e2e       # Playwright at phone width
```

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CLAUDE.md`](CLAUDE.md) (working rules for people and AI agents) before opening a pull request.

## Roadmap

1. Foundation: repo, CI, deploy pipeline (done), theme system, database schema
2. Instance and access: `/setup`, sign-in, invites, email
3. Admin panel `/hq`
4. Core social: profiles, posts, media, follows, likes, reposts
5. Discovery: For you, Mates, search, notifications, privacy
6. Analytics and optional extras
7. Hardening and the first release

Details are in section 16 of [`docs/PRD.md`](docs/PRD.md).

## Licence

[AGPL-3.0](LICENSE). Anyone can run Netmate for any group, free. If you run a modified version for other people, you must publish your changes. The name and logo are covered by [`TRADEMARK.md`](TRADEMARK.md).
