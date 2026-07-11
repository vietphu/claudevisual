# Phase 01 — Advisor Core: types, rules, engine

**Priority:** P0 (foundation) · **Status:** Not started

## Overview

The pure analysis brain. Consumes one `SessionState` → emits severity-ranked
`Recommendation[]`. No `vscode` import, no I/O — unit-testable like `token-economics.ts`.

## Key insights (from data inventory)

- Ground-truth cost = `preciseCostUsd` (statusline wrap only); else pricing estimate.
- Context: `preciseContextPercent` (precise) or `lastTurnContextTokens` fallback via
  `resolveContextPercent` in `core/session-display.ts`.
- 4 token buckets live on `TokenUsage`; economics folds main + sub-agents
  (`core/token-economics.ts`). cache-creation is billed premium → churn = waste.
- Sub-agent tokens are never folded into parent `cumulativeUsage` (reducer invariant).

## Files to create

- `src/core/advisor/advisor-types.ts` — `Recommendation`, `RecommendationSeverity`
  (`critical | warn | info`), `RecommendationCategory` (`cost | context | cache |
  model | orchestration`), `AdvisorContext`, `AdvisorResult`. Plain serializable DTOs
  (this crosses into the webview later — no Maps/Dates), mirroring `sidebar-messages.ts`.
- `src/core/advisor/advisor-thresholds.ts` — all tunable constants with rationale
  comments (context warn 75 / crit 90 — matches existing meter bands in
  `render-vitals.ts:5-13`; cache-churn ratio; sub-agent token cap; min-spend gates).
- `src/core/advisor/advisor-context.ts` — pure `buildAdvisorContext(state)`:
  resolves context%, folds `tokenEconomics`, exposes 4-bucket totals (main + subagents),
  cost via same priority as `session-view-model.resolveCost`.
- `src/core/advisor/advisor-rules.ts` — each rule `(ctx) => Recommendation | null`:
  1. `contextHealthRule` — %≥crit → critical; ≥warn → warn (compact/wrap-up).
  2. `cacheChurnRule` — cacheCreation/cacheRead ratio high AND creation past min-gate.
  3. `cacheEfficiencyRule` — `cacheSavedPct` low while total spend large → info.
  4. `modelRightSizingRule` — model≈opus + low output-share/tool volume → "consider
     Sonnet". Conservative, phrased "consider", never asserted.
  5. `subAgentCostRule` — any sub-agent tokens > cap → flag by type + spawn reason.
  6. `costProjectionRule` — burn + window → projected tokens/cost to context limit.
- `src/core/advisor/advisor-engine.ts` — `analyzeSession(state): AdvisorResult` =
  build ctx → run rules → drop nulls → sort by severity then category. (Score added P02.)

## Todo

- [ ] Define DTOs in `advisor-types.ts` (serializable, documented).
- [ ] `advisor-thresholds.ts` with rationale comments (no plan-ref labels in code).
- [ ] `buildAdvisorContext` folding usage + economics + cost + context%.
- [ ] Six rule functions, each independently pure and null-returning when N/A.
- [ ] `analyzeSession` orchestration + severity ranking.
- [ ] Unit tests `test/suite/advisor-rules.test.ts` + `advisor-engine.test.ts`
      (empty session → no recs; each rule fires on a crafted state and stays silent
      otherwise; ranking order).
- [ ] `npm run typecheck` + `npm test` green.

## Success criteria

- `analyzeSession(emptySessionState(...))` → `{ recommendations: [], ... }`, no throw.
- Each rule has a passing "fires" and "stays silent" test.
- Zero `vscode`/`fs` imports under `src/core/advisor/`.

## Risks

- Model right-sizing false positives → keep gated + "consider" wording; validate
  heuristic against a real opus transcript before enabling by default.
- Threshold bikeshedding → centralize in `advisor-thresholds.ts`, tune post-dogfood.
