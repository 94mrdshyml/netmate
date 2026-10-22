---
name: log-session
description: Append an entry to docs/SESSION_LOG.md at the end of a work session. Use after the ship skill, or when stopping work.
---

# Log session

Append one entry to the end of `docs/SESSION_LOG.md`. Never edit earlier entries. Keep it under 15 lines.

Format:

```
## NN. <short title> (YYYY-MM-DD)
- Branch / PR: <branch>, <PR url or "none">
- Done: <what changed, one line each>
- Tests: <what ran and the result; say so if anything was skipped or failing>
- Decisions: <anything decided that is not already in docs/PRD.md; also update the PRD>
- Open: <questions for the owner, blockers, follow-ups>
- Next: <the single best next step>
```

Rules:
- NN is the previous entry's number plus one.
- Be honest: failed checks, skipped steps and known gaps go in.
- Never log secrets, emails, tokens or IP addresses.
