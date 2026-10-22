# Contributing to Netmate

Thanks for helping. Netmate is early, so please open an issue to discuss a larger change before writing it.

## Ground rules

- The product spec is [`docs/PRD.md`](docs/PRD.md). If your change alters behaviour, update the PRD in the same pull request.
- [`CLAUDE.md`](CLAUDE.md) holds the working rules (stack, commands, hard rules, gotchas). They apply to everyone, not only AI agents.
- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately. See [`SECURITY.md`](SECURITY.md).

## Developer Certificate of Origin (DCO)

We use the [DCO](https://developercertificate.org/), not a CLA. You keep your copyright; your code is licensed under AGPL-3.0 with the project. Sign off **every commit**:

```
git commit -s -m "feat: add invite links"
```

That adds a `Signed-off-by: Your Name <you@example.com>` line. CI fails a branch that has a commit without it. Forgot? `git rebase --signoff main` fixes the whole branch.

## Setup

```
bun install
bun run dev
```

Use **Bun** (`bun install`, `bun run`, `bunx`). Do not use npm, npx, yarn or pnpm. Secrets for local work go in `.dev.vars` or `.env` (both gitignored). See `.env.example`.

## Branches and pull requests

Trunk-based. `main` is protected and always deployable.

1. Branch from an up-to-date `main`: `feat/…`, `fix/…`, `docs/…` or `chore/…`. One topic per branch.
2. Write the change **with tests**. Every behaviour change needs a test.
3. Run locally before pushing:
   ```
   bun run typecheck && bun run lint
   bun run test && bun run test:int
   ```
   Run `bun run test:e2e` when you touch pages. Run `bun run db:generate` and **read the SQL** when you touch the schema.
4. Open **one pull request** per branch. The title must be a [Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `ci:`), because release notes are generated from it.
5. CI must be green: DCO, typecheck, lint, unit and integration tests, build, end to end, dependency audit, secret scan.
6. A maintainer reviews and merges (squash). Merging to `main` deploys the demo instance.

Never skip or weaken a test, a lint rule or a size limit to get green. If a check is wrong, say so in the PR.

## Releases

Maintainers cut releases by hand. In **Actions > Release > Run workflow**, choose `main` and enter a version such as `0.1.0`. The workflow checks that CI is green on that commit, creates the tag and a GitHub Release, and GitHub writes the notes from the merged PR titles, which is why titles must be Conventional Commits. Versions below 1.0 are marked as pre-releases. Contributors do not bump versions.

## Database changes

Migrations are **forward-only** and must be safe to run on an instance at any older version: add first, remove in a later release (expand, then contract). CI applies them from empty and from the previous release.

## Design

The app is product UI for phones. Keep to the PRD's design rules (section 8.13): one brand colour taken from instance settings, no hard-coded brand, flat design, 44px tap targets, WCAG AA contrast. Nothing may hard-code a name, colour, font or logo.

## Good first issues

Look for the `good first issue` label.
