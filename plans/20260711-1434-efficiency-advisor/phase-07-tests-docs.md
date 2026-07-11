# Phase 07 — Tests, docs, live checklist

**Priority:** P1 · **Status:** Not started · **Depends:** 01–06

## Overview

Harden and document. Consolidate advisor tests, update README + docs, extend the manual
live checklist so the advisor is verified against a real Claude Code session.

## Files to touch

- `test/suite/advisor-*.test.ts` — ensure engine, rules, score, pricing all covered;
  add a fixture-based end-to-end test (real-ish `SessionState` → expected recs + grade).
- `README.md` — add Advisor to the Features list + a one-line usage note.
- `docs/manual-live-checklist.md` — add advisor verification steps (context-crossing
  nudge, sidebar section, dashboard tab, status bar, critical notification once).
- `docs/` — if `codebase-summary.md` / `system-architecture.md` exist, note the advisor
  module + data flow; else skip (do not fabricate docs).

## Todo

- [ ] Full advisor test coverage; fixture E2E test.
- [ ] README Features + usage.
- [ ] Manual live checklist advisor section.
- [ ] `npm run typecheck` + `npm test` + `npm run compile` all green.
- [ ] `npm run reinstall` and smoke-test against a live session (confirmed deploy loop).

## Success criteria

- All tests green; advisor verified live end-to-end via the manual checklist.
- README + checklist reflect the shipped feature.

## Open questions

- Whether to persist advisor history for longitudinal reporting (currently nothing
  writes state to disk) — out of scope for v1; revisit if users want day-level trends.
