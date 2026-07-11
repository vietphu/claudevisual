# Phase 04 — Dashboard Advisor tab

**Priority:** P1 · **Status:** Not started · **Depends:** 01, 02

## Overview

An Advisor area in the existing dashboard webview (`src/ui/webview/`): the retrospective
report — Efficiency Score + score-dimension breakdown + the full recommendation list for
the primary (most-recently-updated) session, updating on `onDidChangeMetrics` /
`onDidChange`.

## Files to touch

- `src/ui/webview/messages.ts` — extend the host→client payload with `AdvisorViewModel`
  for the primary session (reuse Phase 03 DTO).
- `src/ui/webview/panel.ts` — compute `analyzeSession` for the primary session on each
  store change (panel already subscribes at `panel.ts:52`); include in the posted state.
- Client render (`src/ui/webview-ui/` — mirror `chart-view.ts` structure): a score
  header + dimension bars + recommendation cards. No chart lib (hand-rolled, per project).
- Reuse severity/category styling tokens from the sidebar (shared CSS values, copied —
  the two webviews don't share a bundle).

## Todo

- [ ] Advisor payload in dashboard messages + `panel.ts` producer.
- [ ] Client render: score header, dimension breakdown, recommendation cards.
- [ ] Cost breakdown (per-bucket from `estimateCostFromUsage`) shown when cost estimated.
- [ ] Typecheck + build; visual check in dashboard.

## Success criteria

- Dashboard shows a coherent per-session efficiency report that updates live.
- Degrades gracefully when only one/zero sessions or no spend yet.

## Risks

- Duplicated styling between two webviews → accept minor copy (no shared bundle exists);
  keep tokens named identically for future extraction.
