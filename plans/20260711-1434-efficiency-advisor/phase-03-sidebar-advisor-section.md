# Phase 03 — Sidebar Advisor section

**Priority:** P1 · **Status:** Not started · **Depends:** 01, 02

## Overview

New collapsible "Advisor" section per session in the sidebar webview, beside Vitals /
Economics / Orchestration. Shows the Efficiency Score (grade + score bar) and the
ranked recommendation list.

## Files to touch

- `src/ui/webview-view/sidebar-messages.ts` — add `AdvisorViewModel`
  (`score`, `grade`, `dimensions[]`, `recommendations[]`) to `SessionViewModel`.
  Plain DTO — reuse the advisor DTOs from `advisor-types.ts` if already serializable,
  else map. Keep the no-`vscode`/no-`core` rule for this file (map in view-model layer).
- `src/ui/webview-view/session-view-model.ts` — call `analyzeSession(state)` in
  `toSessionViewModel`, attach `advisor`.
- `src/ui/webview-view-ui/render-advisor.ts` (new) — render score meter (reuse the
  good/warn/crit color bands pattern from `render-vitals.ts`) + recommendation rows
  (severity dot + category chip + message). Follow `render-economics.ts` DOM style
  (`dom-utils.ts` helpers).
- `src/ui/webview-view-ui/main.ts` — mount the advisor section in the per-session render.
- `src/ui/webview-view-ui/sidebar.css` — severity colors, score meter, collapsible.

## Todo

- [ ] `AdvisorViewModel` on `SessionViewModel` + mapping in `session-view-model.ts`.
- [ ] `render-advisor.ts` (score meter + ranked recs, collapsible like other sections).
- [ ] Mount in `main.ts`; CSS.
- [ ] Test `session-view-model.test.ts`: advisor present, recs ordered, empty session
      → neutral score + no recs.
- [ ] `npm run typecheck` + `npm test` green; visual check in F5 host.

## Success criteria

- Advisor section renders for a session with spend; hidden/neutral when nothing to say.
- Matches existing sidebar visual language (no new design system).

## Risks

- Section noise → collapse by default when score is high (grade A/B) and no critical rec.
