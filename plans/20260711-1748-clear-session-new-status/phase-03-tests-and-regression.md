# Phase 03 — Unit tests + regression run

## Context Links

- Overview: [plan.md](plan.md)
- Depends on: [phase-01](phase-01-propagate-source-and-new-status.md) (required),
  [phase-02](phase-02-cleared-from-continuity-hint.md) (only if built)
- Existing suites to extend:
  - `test/suite/hook-event-parsing.test.ts`
  - `test/suite/session-state-overlays.test.ts`
  - `test/suite/session-view-model.test.ts`
- Test runner: `npm test` (Mocha, pure functions, no VS Code host — see README
  "Development"). Setup: `test/mocha-setup.ts`, mock at `test/register-mock-vscode.js`.

## Overview

- **Priority:** P2 (required — final phase)
- **Status:** done
- **Description:** Add/extend unit tests for every pure function touched, then run
  the full existing suite to confirm no regressions.

## Requirements

- Every pure function changed in Phase 1 (and Phase 2 if built) has a test
  asserting the new behavior AND that existing fields are untouched.
- `npm test` passes green with no skipped/pending tests introduced.

## Related Code Files

**Modify (tests)**
- `test/suite/hook-event-parsing.test.ts` — `parseHookEventLine` captures/validates `source`.
- `test/suite/session-state-overlays.test.ts` — `applyHookEventOverlay` sets
  `lastSessionStartSource` only on `SessionStart`.
- `test/suite/session-view-model.test.ts` — `sessionStartSource` threads through;
  (Phase 2 only) `clearedFrom` predecessor resolution.

**Consider:** a small render-vitals test. `render-vitals.ts` is a pure
string-returning function but has no existing dedicated test file. If adding one
is low-friction, assert the "new" label/dot appears under the fresh gate and not
otherwise; if the webview-ui bundle isn't wired into the Mocha suite, cover the
label decision by asserting on the `SessionViewModel` inputs instead and note the
render assertion as manual (see manual checklist).

## Implementation Steps

1. **hook-event-parsing.test.ts** — add cases:
   - Line with `"source":"clear"` → parsed record has `source === "clear"`.
   - Line with non-string `source` (e.g. number) → `source === undefined`,
     record still valid (other fields intact).
   - Line without `source` → `source === undefined` (back-compat).

2. **session-state-overlays.test.ts** — add cases to the
   `applyHookEventOverlay` describe block:
   - `SessionStart` + `source:"clear"` → `lastSessionStartSource === "clear"`,
     `running === false`, other fields preserved.
   - Non-`SessionStart` event carrying a `source` (shouldn't happen, defensive)
     → prior `lastSessionStartSource` preserved, not overwritten.
   - `SessionStart` with no `source` → prior value preserved.

3. **session-view-model.test.ts** — assert `toSessionViewModel` copies
   `state.lastSessionStartSource` into `sessionStartSource`. (Phase 2 only)
   add `toSidebarViewModel` cases: fresh `clear` session with a same-cwd
   predecessor → `clearedFrom` set to predecessor title (then shortId when no
   title); no predecessor → `clearedFrom` undefined; non-`clear` → undefined.

4. **Run:** `npm run typecheck && npm test`. All green.

5. If any pre-existing test now fails, treat it as a real regression — fix the
   code, not the test (per repo rules: never weaken tests to pass the build).

## Todo List

- [ ] `parseHookEventLine` source cases (valid / invalid-type / absent)
- [ ] `applyHookEventOverlay` source cases (SessionStart set / non-SessionStart preserve / no-source preserve)
- [ ] `toSessionViewModel` threads `sessionStartSource`
- [ ] (Phase 2 only) `toSidebarViewModel` `clearedFrom` cases
- [ ] render "new" label covered (dedicated test or documented-manual)
- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green, no new skips

## Success Criteria

- New assertions cover: source capture, source validation, overlay set-on-
  SessionStart-only, view-model thread-through, (Phase 2) predecessor lookup.
- Full existing suite passes — zero regressions.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| render-vitals not covered by the Mocha bundle | Med | Low | Cover the decision via view-model inputs; log render check in manual-live-checklist. |
| Overlay test asserts too narrowly, misses field clobber | Low | Med | Each overlay test also asserts a pre-set unrelated field (e.g. `model`) survives. |
| Phase 2 cut but its test cases left in | Low | Low | Gate Phase 2 test cases on Phase 2 being built; otherwise omit. |

## Security Considerations

- None — test-only phase.

## Next Steps

- On green: hand back to the orchestrator for code review (`code-reviewer`) and
  a manual walk of the `/clear` scenario against a live session (hooks installed)
  per `docs/manual-live-checklist.md`.
