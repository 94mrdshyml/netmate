# 30. Smooth page changes (2026-10-23)
- Branch / PR: feat/smooth-pages, PR below once opened.
- Owner said moving between screens is not smooth (the old screen was swapped for the new one in one hard cut).
- Done: `app/(app)/(member)/template.tsx` wraps every member screen in React's `ViewTransition`, so the old screen fades out (120ms) while the new one fades in and settles up 8px (200ms). The bottom bar has its own transition name so it stays still and above the fading screens. Taps pass through while it plays. Off with reduced motion. `DESIGN.md` Motion section updated. No new package, no setting in next.config.
- Tests: new e2e in `look.spec.ts` checks a move starts a browser transition, that the fade and rise animations are really running, that the bottom bar is named, and that typing in the search box (same screen) starts none. Full e2e run locally: 103 passed. Typecheck and lint clean.
- Decisions: a quiet fade and rise instead of a sideways slide, to match "nothing slides" in DESIGN.md. Not done: the wait for the server is unchanged (screens are built fresh on each tap); the loading line still covers it.
- Open: I cannot see the live site, so the owner should feel it on a phone. Safari and older browsers just swap screens as before. Ideas if the wait is the real problem: keep visited screens for about 30 seconds (staleTimes) or show the tapped tab as active at once.
- Next: owner picks the next feature (bookmarks and reposts, or pictures and GIFs).
