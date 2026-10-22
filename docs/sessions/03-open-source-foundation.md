# 03. Open-source foundation (2026-10-22)
- Branch / PR: chore/oss-foundation
- Done: AGPL-3.0 `LICENSE`, `README`, `CONTRIBUTING` (DCO), Contributor Covenant 2.1 `CODE_OF_CONDUCT` (contact = private report via the Security tab / owner's GitHub profile), `SECURITY`, `TRADEMARK`, issue and PR templates, `CODEOWNERS`, Dependabot (bun + actions), release-please workflow and config (starts at 0.0.0, pre-1.0 minor bumps), PR-title check for Conventional Commits. DCO script now skips release-please and dependabot branches (bots cannot sign off). `package.json` repository fields.
- Tests: lint and typecheck pass; CI result in the PR.
- Decisions: none new.
- Open: owner enables branch protection on `main` (PR, green checks, squash only, no force-push) and, in Settings > Actions > General, allows Actions to create PRs for release-please. GitHub Actions PRs made with the default token do not trigger CI; if release PRs need checks, add a PAT later. The deploy button only works once the repo is public. Enable private vulnerability reporting in Security settings.
- Next: spike 2 (Better Auth on D1).
