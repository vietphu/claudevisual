# Phase 02 — Split-rate pricing + Efficiency Score

**Priority:** P0 · **Status:** Not started · **Depends:** 01

## Overview

Two upgrades to sharpen the advisor: (a) price the 4 token buckets separately (real
Anthropic rates differ ~10× across input / output / cache-write / cache-read), and
(b) a composite 0–100 Efficiency Score with letter grade + sub-score breakdown.

## Key insights

- `model-pricing.ts` today applies ONE blended rate per model family and only sees the
  economics rollup's blended token total — it throws away the 4-bucket split. The raw
  buckets ARE on `TokenUsage` per model (from `SessionState`), so accurate pricing is
  computable without new I/O.
- `preciseCostUsd` stays the ground truth when present; split-rate is the improved
  ESTIMATE fallback, still labelled "est." per the existing contract.

## Files to touch

- `src/core/model-pricing.ts` — add `ModelRate` split fields
  (`inputPerMTok`, `outputPerMTok`, `cacheWritePerMTok`, `cacheReadPerMTok`); keep
  blended `estimateCostUsd(byModel)` for back-compat; add
  `estimateCostFromUsage(usageByModel: {model, usage: TokenUsage}[])` returning a
  `{ totalUsd, byBucket }` breakdown. Keep the "hard-coded, goes stale, prefer precise"
  caveat comment.
- `src/core/advisor/efficiency-score.ts` (new) — `efficiencyScore(ctx): EfficiencyScore`:
  - `contextHealth` — headroom vs limit.
  - `cacheEfficiency` — `cacheSavedPct` scaled, penalize high creation churn.
  - `modelFit` — reward model appropriate to workload, penalize opus-on-light.
  - `orchestration` — sub-agent ROI (penalize a single agent dominating total spend).
  - Weighted blend → `score` (0–100) + `grade` (A–F) + per-dimension sub-scores.
  Weights documented in `advisor-thresholds.ts`.
- `src/core/advisor/advisor-engine.ts` — fold `score` into `AdvisorResult`.
- `src/core/advisor/advisor-types.ts` — add `EfficiencyScore`, `ScoreDimension`.

## Todo

- [ ] Split-rate table + `estimateCostFromUsage` breakdown (per-bucket USD).
- [ ] `efficiency-score.ts` with 4 documented sub-scores + weighted blend + grade.
- [ ] Wire `score` into `AdvisorResult`.
- [ ] Tests: `model-pricing` split math; `efficiency-score` boundaries (all-good → A,
      context-crit + churn → low grade); monotonicity sanity.
- [ ] `npm run typecheck` + `npm test` green.

## Success criteria

- `estimateCostFromUsage` cost ≈ blended within order-of-magnitude on mixed usage.
- Score deterministic + bounded [0,100]; grade mapping stable; empty session → neutral.

## Risks

- Hard-coded split rates go stale → single source in `model-pricing.ts`, caveat comment,
  precise cost always preferred. Do not surface split-rate cost without an "est." flag.
