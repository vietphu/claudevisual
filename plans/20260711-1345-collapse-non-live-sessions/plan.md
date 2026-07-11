# Collapse non-live sessions to their vitals row

## Problem

Follow-up to [[20260711-1312-session-title-from-ai-title]]. Even with a
distinct title per session, a project with several historical/dead sessions
still buries the one actually running underneath a wall of Orchestration /
Token Economics / Activity detail for sessions nobody is looking at anymore.

## Approach

Keep the current flat scroll layout (no new card chrome/background). Each
session's vitals block (`renderVitals`) always stays visible; everything
below it (Orchestration, Token Economics, Activity) is wrapped in a `.cv-body`
that collapses by default for any session where `SessionViewModel.live` is
`false` — a dead/historical transcript, distinct from `running` (actively
working) and the "live-but-idle-waiting-for-input" case, both of which stay
expanded by default. Chosen over per-session background tinting: zero added
visual weight, and the currently-active session reads as "the one with detail
underneath it" without needing color.

Clicking (or Enter/Space on) the vitals header (`.v-top`) toggles the body,
mirroring the existing Agent-row / Activity-panel click-to-expand pattern in
`main.ts`. A manual toggle is remembered per `sessionId` in a client-side
`Map<string, boolean>` and wins over the live-based default until that
session disappears from the view-model — same lifecycle as the existing
`openAgents`/`openActivity` sets.

Unlike those two, the collapsed/expanded class is computed directly inside
`renderSession()` at template-build time (the map is in the same module-level
scope as the render function), not patched onto the DOM in a second pass
after `innerHTML` — simpler, and avoids a redundant reconciliation step. The
`.v-top` toggle is intentionally NOT gated behind a `has-detail` check like
the Agent row is: every session's body always has at least the "no sub-agents
spawned yet" placeholder, so toggling is always meaningful.

## Changes

- `src/ui/webview-view-ui/render-vitals.ts` — `renderVitals` takes a second
  `expanded: boolean` param; adds `role="button" tabindex="0"
  aria-expanded="..."` to `.v-top`.
- `src/ui/webview-view-ui/main.ts` — new `sessionOverrides: Map<string,
  boolean>` (collapsed, keyed by sessionId); `renderSession` wraps
  agents/economics/activity output in `<div class="cv-body">`; new
  `toggleSession` click/keydown handler; prune stale ids from the map on
  every `render()` call (hygiene, matches `openAgents`/`openActivity`).
- `src/ui/webview-view-ui/sidebar.css` — `.v-top { cursor: pointer }` +
  focus-visible outline + `::after` caret (mirrors `.act-toggle`);
  `.cv-body` gets the `gap: 12px` `.cv-session` used to apply directly to its
  children; `.cv-session.collapsed .cv-body { display: none }`.

## Out of scope

- No manual rename/pin, no background-tint card treatment (the alternative
  considered and declined in favor of this lighter option).
- No "auto re-collapse a session that goes idle mid-use" — the default is
  computed from the current `live` value on every render, so this actually
  falls out for free: once a session's process exits, the next render's
  `!s.live` default takes over unless the user had already set an explicit
  override for it.
