# 20. Avatar seeded by username (2026-10-23)
- Branch / PR: fix/avatar-seed-username
- Before this: PR #37 (`/hq/branding`) is merged and live.
- Problem: members were seen with the same default picture. Cause: seed was the account id; the Initials style (the default) is seeded by the name, so two people with the same letters and name got the same picture.
- Done: `defaultAvatarSvg` takes `{ username, name }`. Every style except Initials is seeded by the username (unique, stored lower case, never changeable, so a picture is stable and never shared). Initials still draws letters from the name but its background colour is picked from ten dark colours by a hash of the username, so two "Sam Lee" differ. `/avatar/[userId]` now reads the username; the branding samples use a fixed sample username. `docs/PRD.md` updated (two places).
- Tests: unit test now seeds by username, plus a new test that two people with the same name get different pictures in all eight styles. Avatars and branding e2e pass.
- Known limit: Initials has ten colours, so with many same-name members two can still share a colour (they differ if usernames hash apart; not guaranteed).
- Next: logo, favicon and font hosting, then `/hq/email`.
