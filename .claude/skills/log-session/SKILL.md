---
name: log-session
description: Write the session log file for this work session in docs/sessions/. Use after the ship skill, or when stopping work.
---

# Log session

Create one new file `docs/sessions/NN-short-title.md` (NN is the highest existing number plus one, two digits; the title is a few lowercase words joined by hyphens). Never edit earlier session files. Never append to a shared file: one file per session means two open PRs cannot conflict. Keep it under 15 lines.

Format:

```
# NN. <short title> (YYYY-MM-DD)
- Branch / PR: <branch>, <PR url or "none">
- Done: <what changed, one line each>
- Tests: <what ran and the result; say so if anything was skipped or failing>
- Decisions: <anything decided that is not already in docs/PRD.md; also update the PRD>
- Open: <questions for the owner, blockers, follow-ups>
- Next: <the single best next step>
```

Rules:
- Be honest: failed checks, skipped steps and known gaps go in.
- Never log secrets, emails, tokens or IP addresses.
- The file goes in the same PR as the change it describes.
