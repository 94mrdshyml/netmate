# 09. Session log: one file per session (2026-10-22)
- Branch / PR: chore/session-log-files
- Done: `docs/SESSION_LOG.md` is gone. Its nine entries are now `docs/sessions/00-...md` to `08-...md`, contents unchanged. New sessions add their own file, so two open PRs can never conflict on the log (they conflicted on #6 and #23 when both appended to the same file). CLAUDE.md, the `log-session` skill and the README link are updated.
- Tests: docs and skill text only; lint and typecheck unaffected.
- Decisions: two branches choosing the same NN is harmless because titles differ.
- Open: none.
- Next: instance and profile tables, then saving and reading instance settings.
