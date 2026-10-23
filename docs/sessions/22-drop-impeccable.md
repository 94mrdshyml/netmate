# 22. Drop impeccable for the taste skill (2026-10-23)
- Branch / PR: chore/design-skill-taste
- Decision (owner): no `impeccable`; use the `design-taste-frontend` ("taste") skill for all UI work. `CLAUDE.md`, `DESIGN.md` and session 19 already say so, so no rule text changed.
- Done: `.claude/settings.json` now turns the `impeccable` plugin off for this project (its design hook kept flagging test data such as the font name "Inter"). The stray `.impeccable/` folder it created (an ignore list and a cache) is deleted and was never committed.
- Left alone: the plugin is still installed in the owner's user settings for other projects; `docs/sessions/01` mentions an unrelated package name only in passing.
- Next: `/hq/email`.
