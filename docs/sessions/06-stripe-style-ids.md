# 06. Stripe-style ids (2026-10-22)
- Branch / PR: feat/prefixed-ids
- Done: ids are now `{prefix}_{24 base62 chars}` (`usr_`, `sess_`, `acc_`, `ver_`) instead of UUIDs. New `src/lib/ids.ts` (`newId`, `randomId` with rejection sampling so every character is equally likely, `isId`, `ID_PREFIXES`). Better Auth `generateId` uses it and throws for a model with no prefix. PRD section 10 and decision 16, and the IDs line in CLAUDE.md, updated.
- Tests: 8 new unit tests (format, no `_` or `-` in the random part, 20,000 ids with no repeat, even spread over all 62 characters, per-model validation). Auth integration tests now assert `usr_`, `acc_` and `sess_` ids. A real bug was caught by the even-spread test: `crypto.getRandomValues` accepts at most 65,536 bytes per call; `randomId` now chunks. Local: typecheck, lint, 14 unit and 16 integration tests pass.
- Decisions: ids are random, not time-ordered, so ordering uses the time column and cursors stay `(milliseconds, id)`. Invite link codes will be a separate longer random value, not an id. No data migration needed: no users exist yet.
- Open: none.
- Next: spike 3 on remote D1, then the schema (instance, profiles, invites) and theme tokens.
