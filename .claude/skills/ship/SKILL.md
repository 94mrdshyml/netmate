---
name: ship
description: Push the current branch, open a PR, watch CI, fix failures (max 3 attempts), then hand the green PR to the owner to merge. Use when a change is done and tested locally.
---

# Ship

Production is CI-only (CLAUDE.md hard rule 1). This skill never deploys by hand and never merges by hand.

1. **Check.** `git status` clean except intended files. Branch is not `main`. Typecheck, lint and affected tests passed locally. If not, stop and run them.
2. **Commit.** Conventional commit message, signed off (`git commit -s`). One logical change per commit. Never `--no-verify`.
3. **Push.** `git push -u origin <branch>`. Never push to `main`, never force-push.
4. **Open PR.** `gh pr create` with a Conventional Commits title (release-please reads it). Body: what changed, why, how it was tested, whether `docs/PRD.md` changed, and migrations (if any) with the note "forward-only, safe on older instances".
5. **Watch CI.** Find the run with `gh run list --branch <branch> --limit 1`, note the run ID, then poll the jobs: `gh run view <id> --json jobs --jq '[.jobs[].status]|unique'` every 15 seconds until every job is `completed`. Do not trust `gh run watch` or the run-level status alone: they can report success while jobs are still queued or running. Then list each job's conclusion.
6. **Fix.** On failure, read the failing job log, fix the cause (never weaken a test, snapshot, lint rule or size limit), commit, push. Maximum **3** fix attempts. After 3, stop and write a report: failing jobs, run IDs, what was tried, suspected cause.
7. **Hand over.** When green, stop. The owner reviews and merges the PR. Never run `gh pr merge`, with or without `--auto`.
8. **Watch the deploy.** After the owner merges, the push to `main` runs CI again and its `deploy` job ships to Cloudflare. Poll that run the same way until the `deploy` job completes. If it fails, pull the log (`gh run view <id> --log-failed`), fix on a new branch, and open a new PR (max 3 attempts). Then fetch the live URL and confirm it.
9. **Report.** Give the PR URL, the CI result, the deploy result and live URL, and anything skipped or failing.

Report plainly if anything failed or was skipped.
