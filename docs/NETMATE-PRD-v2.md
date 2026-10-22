# Netmate v2: Product Requirements (open source, self-hosted)

**Version:** 2026-10-22. **Status:** draft for owner review. Nothing is built.

This replaces `NETMATE-PRD.md` as the plan of record. The old document describes the first idea (`netmate.vercel.app`, Vercel + Neon). **Nothing from that deployment is reused: no data, accounts, code, assets or brand.** Its feature design and logic (feed scoring, visibility rule, analytics rules) are kept as a reference and re-specified here. Where this document says "as v1", the behaviour is in `NETMATE-PRD.md` section 5 and carries over unchanged unless a delta is listed.

## Contents

1. What Netmate is
2. Product rules
3. Instance lifecycle and roles
4. Setup (`/setup`)
5. Customisation
6. Membership: invites and approvals
7. Email
8. Social features (carried over from v1, with deltas)
9. Screens and routes
10. Data
11. Architecture (Cloudflare only)
12. Security and privacy
13. Quality, CI/CD and branching
14. Open-source project setup
15. Build plan
16. Risks and open checks
17. Decisions still open
18. Not in v1

---

## 1. What Netmate is

Netmate is an open-source, self-hostable, Twitter/X-style microblogging app for a private community: family and friends, a school, or an organisation. One deployment is one instance, with its own members, data, name and look. There is no global network and no federation.

**Who it is for:** the person who sets an instance up (the **admin**) and the people they invite (**members**). Members use it on their phones.

**Pitch:** your own small, calm, branded social feed that shows people what is worth reading and tells them honestly how their posts are doing.

**What stays from v1:** Mates ("Followed by Meera and 2 more"), owner-only counts-only analytics, a ranked For you feed, privacy tools. **What is new:** instance customisation, first-run setup, invite-only membership with admin approval, admin panel, Resend-powered email, an open-source project around it.

## 2. Product rules

1. **Mobile column everywhere, except `/hq`.** Every member page, plus `/setup`, `/sign-in`, `/sign-up`, is one centred column of at most 480px. `/hq` is the only page with a wide, desktop-capable layout.
2. **Invite-only.** No public sign-up. No public profile or post pages. Signed-out visitors see only sign-in and sign-up-with-invite.
3. **Privacy first.** As v1: private accounts, block, mute, owner-only analytics and bookmarks.
4. **Counts, not names, in analytics.** As v1.
5. **Say what you want, don't toggle.** As v1 (idempotent actions).
6. **Be honest in the UI.** As v1.
7. **The instance owns its brand.** No hard-coded name, colour, font or logo anywhere in the product or in emails. Everything reads from instance settings.
8. **Calm by default.** Flat design, no shadows or gradients, one brand colour. The brand colour is the only colour apart from system states.

## 3. Instance lifecycle and roles

States of an instance:

| State | Meaning | What happens on any request |
|---|---|---|
| **Unconfigured** | deployed, no admin yet | every route redirects to `/setup` |
| **Configured** | setup finished | `/setup` returns 404 permanently |

Roles:

| Role | Can |
|---|---|
| **Admin** (exactly one at setup; more admins are a later feature) | everything a member can, plus `/hq`: branding, approvals, invites, quota |
| **Member** | use the app, own a personal invite link |
| **Pending** | has signed up through a member link past that member's quota. Cannot sign in until approved |

The "is the instance configured?" check runs on every request, so it must be a cheap cached read. Once true it never returns to false.

## 4. Setup (`/setup`)

First open of a fresh deployment. One mobile-width, multi-step flow:

1. **Prove ownership.** Enter the `SETUP_TOKEN` secret that was set at deploy time (see section 12; recommended so a stranger who finds the URL first cannot claim the instance).
2. **Admin account.** First name, last name, email, username, password (same rules as v1).
3. **Instance identity.** Name, logo, favicon.
4. **Look.** Primary colour, corner radius, font, default avatar style. A live preview shows a sample post, button and field.
5. **Email.** Resend API key and sender address. The key is validated by a real call. Skippable, with a clear warning of what then does not work (verification, reset, notifications; invite links must be shared by hand).
6. **Optional services.** Klipy key for GIF search (hidden if blank), place suggestions on or off.
7. **Finish.** Creates admin, saves settings, marks the instance configured, signs the admin in, lands on Home with a short "invite your first people" prompt.

Rules:

- The final write is **atomic**: admin, settings and the "configured" flag succeed together or not at all. Two people finishing at once: exactly one wins, the other sees the sign-in page.
- Everything entered before the last step is kept in the browser session only; nothing is partially saved to the database.
- After completion `/setup` cannot be reached, even by the admin. Changes go through `/hq`.

## 5. Customisation

All values live in instance settings, are edited in `/hq` (and first chosen in `/setup`), and apply to every page and email.

| Setting | Options and rules |
|---|---|
| **Name** | 1 to 30 characters. Shown in the top bar, page titles, emails, share text |
| **Logo** | PNG or SVG, up to 1 MB, square or wide. Emails use a PNG version (many mail apps do not render SVG), so SVG uploads also need a PNG, or the logo falls back to the name as text in email |
| **Favicon** | PNG or SVG, at least 512px square for PNG. Used for the browser tab and home-screen icon |
| **Primary colour** | any hex colour. The system derives the text colour on top of it, hover and pressed shades, and a dark-mode variant, and **refuses or adjusts** any choice that cannot reach WCAG AA contrast (4.5:1 for text) in both themes. Light-mode text-link colour is darkened automatically (the v1 gold-on-white problem, solved generally) |
| **Corner radius** | `zero`, `sm`, `md`, `lg`. Applies to buttons and form fields. Fixed values: 0, 4px, 8px, 16px. Avatars stay round; post media keeps its own fixed radius |
| **Font** | any family from Google Fonts. Chosen from a searchable list in `/hq`. The font file is fetched once at save time and **stored and served from our own bucket**, so readers never contact Google (see decision 4) |
| **Default avatar style** | any DiceBear style (for example Cameo, Initials, Thumbs). Avatars are generated inside the app from the member's id, so they stay stable and make no outside request |
| **Theme** | dark, light, or follow the phone. Members can still override with the toggle |

Defaults on a fresh instance: name "Netmate", a simple built-in logo and favicon, a neutral accessible primary colour, radius `md`, font Inter, avatar style Cameo.

Applying settings: colours, radius and font become CSS variables set on the page, so there is no rebuild or redeploy after a change. Settings are cached and the cache clears when `/hq` saves.

## 6. Membership: invites and approvals

Sign-up works only through an invite link.

**Links**

- The admin has one personal invite link, unlimited use.
- Every member has one personal, reusable invite link, shown in their Settings with a copy and share button.
- A link is `/sign-up?invite=<code>`. The code identifies the member it belongs to, so every account records **who invited them**.

**Quota**

- Each member's link auto-approves their first **5** sign-ups (the number is an instance setting, default 5, edited in `/hq`).
- From the 6th sign-up through that link, the new account is created as **Pending**. It cannot sign in. The person sees "Waiting for approval".
- The count is signups through the link, ever. A deleted, rejected or pending invitee does not free a slot.
- The admin's own link is never limited.
- The check and the status are decided in one atomic database step, so two people using the 5th and 6th slot at the same moment get the right outcome.

**Approvals (admin, in `/hq`)**

- A queue of Pending sign-ups, showing name, username, email, time, and which member's link they came through.
- Approve: account becomes a member. Reject: account is deleted and the email can be used again.
- The admin is told by a badge in `/hq` and, if email is set up, an email. The person is told of approval or rejection by email.

**Controls**

- The admin can revoke or regenerate any member's link (for a leaked link). Existing accounts are unaffected.
- Sign-ups per link and per IP are rate-limited.
- Sign-up requires email verification when email is set up. Pending approval is a separate gate after it.

**Later (not v1):** email-domain rules, closed or open sign-up modes, more admins, per-person quota overrides. Sign-up policy is stored as a setting now so these can be added without redesign.

## 7. Email

Provider: **Resend**. Templates: **React Email**, rendered on the server. Every template uses the instance's name, logo, primary colour, radius and font (web-safe fallback where mail apps ignore custom fonts).

| Email | Sent to | When |
|---|---|---|
| Verify email | new member | after sign-up |
| Welcome | new member | after verification and approval |
| Reset password | member | "forgot password" |
| Confirm new email | member | change email |
| Pending sign-up | admin | a Pending account is created |
| Approved / Rejected | invitee | admin decides |

Rules:

- If no Resend key is set, email-dependent features degrade gracefully and say so: verification is skipped, "forgot password" is hidden, invite links are shared by hand, and `/hq` shows a clear banner "Email is not set up".
- `/hq` has a "send test email" button and shows the last send error.
- The Resend key is stored encrypted (section 12). It is never shown again after saving; the form shows only "key saved" and lets the admin replace it.
- The sender address must be on a domain verified in Resend. The setup step explains this and shows Resend's error if it is not.
- Email logos must be reachable by mail apps, so they are served from the public media domain as PNG.

## 8. Social features (carried over from v1)

Behaviour is as in `NETMATE-PRD.md` section 5, with these deltas.

| Area | Carried over | Delta in v2 |
|---|---|---|
| Posting | 280 characters, up to 4 photos or one GIF, quotes, replies, hashtags, mentions, link previews, delete, share, bookmarks | Link-preview fetcher needs a new safe design on Workers (risk R10). GIF button appears only if a Klipy key is set |
| Home feed | Following and For you, the exact scoring formula and constants, new-posts pill, Mates block | Score is computed in TypeScript over candidates fetched by simple SQL |
| Profiles | banner, avatar, bio, link, location, Posts and Replies tabs, Mates line | City suggestions are optional (setting). Default avatars follow the instance's DiceBear style |
| Following and Mates | follow, followers, following, suggestions | Suggestions fill from the people the member's inviter and invitees follow before falling back to newest members |
| Search | people and posts, hashtags | Simple matching in v1; a search index is a later option |
| Notifications | like, repost, follow, follow request, reply, quote, mention | New: "your invite was used" and, for admin, "pending approval" |
| Privacy | private account, block, mute, the single `visibleTo` rule | Unchanged |
| Bookmarks | private saves | Unchanged |
| Analytics | owner-only, events, funnel, best posts, 7/28 days, 60-day retention | Unchanged |
| Rate limits | table of v1 limits | Same numbers, plus invite and approval limits |
| Account | change password, delete account | Now also: verify email, forgot password, change email. Username still cannot change |
| Design | 44px targets, safe areas, WCAG AA, no emoji, one icon set | No fixed yellow. Everything uses the instance tokens |

Removed from v1: all fixed branding, Neon, Vercel, the seed-in-production approach. A **seed script remains for local development and tests only** and can never run against a configured production instance.

## 9. Screens and routes

| Route | Screen | Width |
|---|---|---|
| `/setup` | First-run setup. 404 once configured | mobile |
| `/sign-in` | Sign in | mobile |
| `/sign-up?invite=` | Sign up with invite. Invalid or revoked code shows a clear message | mobile |
| `/waiting` | Pending approval notice | mobile |
| `/forgot-password`, `/reset-password` | Password reset | mobile |
| `/verify-email` | Email verification landing | mobile |
| `/` | Home: For you (default), Following | mobile |
| `/compose`, `/[username]`, `/[username]/status/[id]`, `/[username]/followers`, `/[username]/following`, `/search`, `/notifications`, `/bookmarks`, `/analytics` | As v1 | mobile |
| `/settings` and sub-pages: profile, account, privacy (requests, blocked, muted), **invite** | As v1, plus the personal invite link | mobile |
| `/hq` | Admin: overview | **wide** |
| `/hq/branding` | Name, logo, favicon, colour, radius, font, avatar style, live preview | **wide** |
| `/hq/approvals` | Pending sign-ups | **wide** |
| `/hq/invites` | Admin link, quota setting, member links with usage, revoke and regenerate | **wide** |
| `/hq/email` | Resend key, sender, test email, status | **wide** |
| `/api/auth/*`, `/api/me`, `/api/upload` | Auth, session probe, upload | n/a |

`/hq` is admin-only. A non-admin sees 404, not "forbidden".

Reserved usernames now also include `hq`, `setup`, `waiting`, `invite`, plus the v1 list.

## 10. Data

All on Cloudflare D1. Ids are text (UUIDs created in code). Times are integer milliseconds UTC. Yes/no is 0/1. Enums are text with a check.

New or changed tables beyond the v1 list (`profiles`, `posts`, `post_media`, `post_links`, `post_tags`, `follows`, `follow_requests`, `blocks`, `mutes`, `likes`, `reposts`, `bookmarks`, `notifications`, `rate_hits`, `analytics_events`):

| Table | Holds |
|---|---|
| `instance` | one row: configured flag, configured time, name, logo key, favicon key, primary colour, radius, font family, avatar style, theme default, invite quota, sign-up policy, feature flags (GIFs, places) |
| `instance_secrets` | encrypted values: Resend key, Klipy key. Separate from `instance` so they are never read by theme code |
| `invite_links` | member id, code, created time, revoked time, uses count |
| `invite_uses` | invite link, new user, time, outcome (`approved` / `pending`) |
| `profiles` (changed) | adds `role` (admin or member), `status` (active, pending), `invited_by`, `email_verified_at` |
| `fonts` | cached font files for the chosen family: storage key, weight, style |

Better Auth owns its own tables (users, accounts, sessions, verifications). Counters on posts change in the same batch as the row that causes them (as v1, via `db.batch()`).

## 11. Architecture (Cloudflare only)

```
Browser
  │
  ▼
Cloudflare (DNS, CDN, optional WAF and Turnstile)
  │
  ▼
Worker "netmate"  ── Next.js 16 via @opennextjs/cloudflare
  │   Server Components · Server Actions · Route Handlers · Better Auth at /api/auth
  ├──► D1 "DB"          app data, instance settings, auth data
  ├──► R2 "MEDIA"       photos, logo, favicon, cached fonts. Public reads through a media domain
  ├──► Rate Limiting    high-volume limits
  ├──► Cron Trigger     daily clean-up of old analytics rows and rate hits
  └──► Resend (HTTPS)   email
```

- **Plan:** Workers Paid is the realistic minimum (CPU time and queries per request). Documented in the README.
- **Deploy:** a "Deploy to Cloudflare" button creates the Worker, D1 and R2 and prompts for secrets (`SETUP_TOKEN`, `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`). Migrations run on every deploy.
- **Config at request time:** instance settings are read from D1 (cached per isolate, cleared on save) and turned into CSS variables in the page head.
- **Uploads:** through the Worker (`POST /api/upload`), which checks session, rate limit, type and size, sniffs the first bytes, then writes to R2.
- **Rate limiting:** exact, low-volume limits (sign-in, sign-up, password, invites) in a D1 table; high-volume ones (likes, analytics events) use the Rate Limiting binding.
- **Middleware:** `proxy.ts` is not supported by OpenNext; use an Edge `middleware.ts` only for the cheap setup-state redirect, or do the check in the root layout. Every page and action still checks the session itself.
- **Upgrades:** instances upgrade by pulling a new release and redeploying. Migrations must be forward-only and safe to run on any instance at any older version (expand, then contract across releases).
- **Local dev:** `wrangler dev` with local D1 and R2. Bun for scripts, package-manager choice to be confirmed in the repo (decision 7).

## 12. Security and privacy

- **Setup takeover.** `/setup` requires `SETUP_TOKEN` and is atomic and one-time. After completion it is gone.
- **Secrets at rest.** Resend and Klipy keys are encrypted in D1 with `SETTINGS_ENCRYPTION_KEY` (a Worker secret). They are never returned to the browser or written to logs. Losing the encryption key means re-entering the keys, not losing data.
- **Admin surface.** `/hq` and its actions check role on the server every time and return 404 to non-admins.
- **Invites.** Codes are long and random. Revocable. Rate-limited per link and per IP. Quota check is atomic.
- **Everything from v1 section 9 carries over:** every action checks the session, post text is always rendered as text, upload checks (type, size, ownership, existence), one `visibleTo` rule, analytics owner-only, theme cookie only.
- **Theming safety.** Colours are validated as hex, font family names validated against the Google Fonts list and sanitised, so settings can never inject CSS or script.
- **Branding uploads.** Logo and favicon are validated by type and size; SVG is sanitised or rasterised so it cannot carry script.
- **Link preview fetcher.** Must refuse private and internal addresses, redirects re-checked, strict timeout and size (R10).
- **No third-party requests from readers by default:** fonts, avatars and icons are all self-hosted. The only outside requests are GIF search (Klipy, if enabled) and pictures inside link previews.
- **Security policy.** `SECURITY.md` with a private report channel. Dependency and secret scanning in CI.

## 13. Quality, CI/CD and branching

**Tests**

| Layer | What | Tool |
|---|---|---|
| Unit | validation, text parsing, cursors, feed scoring, colour contrast derivation, invite quota logic | Vitest |
| Integration | real server code against local D1: feed, paging, visibility, privacy, invites and approvals, setup atomicity, search, notifications, analytics | Vitest with the Workers pool |
| Email | each template renders with a sample brand; snapshot plus an HTML sanity check | Vitest |
| End to end | `/setup` through first post; invite, 5 auto-approved, 6th pending, admin approves; sign-in; branding change shows everywhere | Playwright at phone width |
| Accessibility | axe checks on key screens in light, dark, and with extreme brand colours | axe via Playwright |
| Theme matrix | each radius, a light and a dark primary colour, a tall and a wide font, all remain readable and unbroken | Playwright screenshots |

**CI (GitHub Actions), required to merge:** install, lint, typecheck, unit, integration, build (OpenNext), end-to-end, dependency audit, secret scan. A migration check confirms that migrations apply cleanly from empty and from the previous release.

**Delivery**

- Every PR gets a preview deploy (separate Worker, D1 and R2 for previews).
- Merge to `main` deploys a live **demo instance** with data reset on a schedule.
- A release tag creates a GitHub Release with notes and publishes the deploy button target.

**Branching (trunk-based)**

- `main` is protected: PR required, CI green, at least one review (the owner can self-merge until there are other maintainers), linear history, squash merge, no force pushes.
- Short-lived branches named `feat/…`, `fix/…`, `docs/…`, `chore/…`. Long-lived branches are not used.
- **Conventional Commits** enforced on PR titles. **release-please** opens release PRs that bump the version (semver) and write the changelog. Until 1.0, breaking changes bump the minor version.
- Releases: `v0.x` while the feature set settles, `v1.0` when upgrade paths and the setup flow are stable.
- Hotfixes: branch from `main`, fast PR, patch release.

## 14. Open-source project setup

- **Licence: AGPL-3.0.** Anyone can run it for any group, free. Anyone who runs a modified version for others must publish their changes. This blocks closed hosted forks, as with Mastodon and Lemmy.
- **Name and logo** are covered by a short trademark note: forks may rebrand freely but may not pass as the official project.
- **Contribution terms:** DCO (sign-off) rather than a CLA, to keep contribution friction low.
- **Files at the root:** `README.md` (what, screenshots, one-click deploy, plan requirements), `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `TRADEMARK.md`, `.github/` issue templates, PR template, `CODEOWNERS`, Dependabot.
- **Docs:** self-hosting guide (deploy, secrets, Resend setup, custom domain, media domain, backups and D1 export, upgrading), admin guide (`/hq`), contributor guide (local setup, tests, architecture), and a feature-by-feature spec folder.
- **Issue hygiene:** labels, "good first issue", a public roadmap board.

## 15. Build plan

Greenfield. CI exists from the first commit.

| Phase | Output |
|---|---|
| **0. Spikes** (throwaway) | (1) Next 16 on Workers via OpenNext with a server action and Edge middleware. (2) Better Auth on D1: sign-up, sessions, hashing time against the CPU limit, text ids. (3) D1 SQL support: window functions, `ln`/`pow`, `INSERT OR IGNORE`, recursive queries, foreign keys. (4) R2 upload through Worker and read through a media domain. (5) Fetching a Google font and serving it from R2. (6) Link-preview SSRF approach on Workers. Each ends with a written yes or no |
| **1. Foundation** | Repo, AGPL, OSS files, CI, branch rules, release automation, Next + OpenNext skeleton, D1 schema and migrations, test harness, the theme token system with the contrast-safe colour derivation, deploy button, README |
| **2. Instance and access** | Setup flow with `SETUP_TOKEN`, atomic one-time configure, Better Auth, sign-in, invite links and quota, pending state, waiting screen, email verification and reset (Resend + React Email), the branded email templates |
| **3. `/hq` v1** | Wide admin layout, branding editor with live preview and font fetching, approvals queue, invites view, email settings and test send |
| **4. Core social** | Profiles, posts, media upload, follow, like, repost, quote, reply, bookmark, hashtags, mentions, Following feed |
| **5. Discovery** | For you ranking, Mates, suggestions, search, notifications, privacy (private, block, mute) |
| **6. Insight and extras** | Analytics, GIFs (optional), link previews, place suggestions (optional) |
| **7. Hardening and 0.1 release** | Accessibility pass, theme matrix, security review, docs complete, demo instance, first tagged release |

Phases 4 to 6 can overlap once phase 2 is done. Phases 1 to 3 form the first usable milestone: a deployable, brandable, invite-only shell.

## 16. Risks and open checks

| # | Item | Status |
|---|---|---|
| R1 | D1 has no interactive transactions. Use `db.batch()` and SQL counters | Planned |
| R2 | D1 limits: 100 bound values per query, 100 KB per statement, 10 GB database | Planned around |
| R3 | `ln`, `pow`, window functions on D1 | Open (spike 3). Fallback: score in TypeScript |
| R4 | OpenNext and Next 16: Node middleware unsupported | Use Edge `middleware.ts` or layout check. Open (spike 1) |
| R5 | Better Auth on D1 with text ids; hashing fits CPU limit | Open (spike 2) |
| R6 | Worker bundle size limit (10 MiB compressed on Paid) | Open |
| R7 | Self-hosters on Workers Free will hit CPU and query limits | Document Paid as required; test on Paid |
| R8 | Font fetch at runtime: Google Fonts API behaviour, licensing (OFL fonts only), file size | Open (spike 5) |
| R9 | Accessible colour derivation for any hex, in both themes | Design and test in phase 1 |
| R10 | Link-preview fetcher cannot pin resolved addresses on Workers | Open (spike 6). Fallback: feature off by default |
| R11 | Migration safety across instances at different versions | Policy: expand then contract; CI checks upgrade from previous release |
| R12 | Email deliverability depends on the admin verifying a sending domain | Document clearly; setup shows Resend's errors |
| R13 | Logo SVG in email clients | Require PNG for email, fall back to text name |
| R14 | Single D1 writer, location hint | Fine at this scale; document hint choice |
| R15 | Invite abuse (leaked link, quota gaming) | Rate limits, revoke, admin approval past quota |
| R16 | Losing `SETTINGS_ENCRYPTION_KEY` | Documented; recovery is re-entering keys |

## 17. Decisions still open

1. **`SETUP_TOKEN`.** Require it at `/setup`? Recommended yes; the deploy button prompts for it.
2. **Domain.** One domain for the app and a media subdomain per instance (documented), or media on the Worker domain. Recommended: separate media domain, optional for a first try.
3. **DCO vs CLA.** Recommended DCO.
4. **Fonts.** Self-host the chosen Google font in R2 (recommended, no reader contact with Google) or link to Google's CDN (simpler, leaks reader IPs).
5. **Demo instance.** Host an official demo with scheduled reset? Recommended yes, after phase 7.
6. **Name of the project vs instance default.** Is the default instance name "Netmate", and do we ship a default logo?
7. **Package manager and repo layout.** Single app or monorepo (app, docs, email package)? Recommended single app with a `docs/` folder.
8. **Search.** Plain matching in v1 or a search index from the start.
9. **Cloudflare features beyond v1.** WAF, Turnstile on sign-up, error reporting. Recommended: Turnstile optional in settings after v1.

## 18. Not in v1

Federation, direct messages, video, polls, lists, verified badges, ads, native apps, multiple admins, email-domain rules and open sign-up modes, per-member quota overrides, trending hashtags, typo-tolerant search, a Likes tab on profiles, moderation reports queue, data export for members, instance-to-instance migration tooling.
