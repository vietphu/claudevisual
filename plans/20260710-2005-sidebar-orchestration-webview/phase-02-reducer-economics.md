---
phase: 2
title: Reducer + Economics
status: completed
priority: P1
effort: 0.5-1d
dependencies:
  - 1
---

# Phase 2: Reducer + Economics

## Overview

Two small, low-risk data enrichments plus the economics section. Capture per-agent **model** and
**spawn reason** (both already flow through the reducer but are discarded), then compute + render
token economics: input/output split, cache savings, per-model rollup, and the stacked-by-agent bar.
No new files to read — all data already parsed.

## Requirements

- Functional: each agent node shows its model chip (opus/sonnet/haiku tier color) and a one-line
  spawn reason. Economics card shows total tokens, est. cost, a stacked bar segmented by agent
  (agent-identity colors), a per-model rollup (opus/sonnet/haiku token sums), and a cache-savings
  line (% of tokens served from cache).
- Non-functional: additions are backward-compatible (optional fields); no change to
  `cumulativeUsage` semantics; pure-fn additions unit-tested.

## Architecture

**Type changes** ([types.ts](../../src/core/types.ts)):

- `SubAgentState` gains `model?: string` and `spawnReason?: string`.
- Add pure helper `tokenEconomics(session)` → `{ totalTokens, freshTokens, cacheReadTokens,
  cacheSavedPct, byAgent: {agentId, tokens}[], byModel: {model, tokens}[] }` in a new
  `src/core/token-economics.ts` (keep types.ts lean).

**Reducer changes** ([state-reducer.ts](../../src/core/state-reducer.ts)):

- `reduceSubAgentLine` already reads `message` — also capture `message.model` into
  `SubAgentState.model` (first non-empty wins; a subagent's model is stable).
- `upsertSubAgentFromTask` already receives the `Task` `input` — also read `input.description`
  (fallback: `input.prompt` truncated) into `spawnReason`.
- Per-model rollup folds the **main** session model (`state.model` + `cumulativeUsage`) with each
  subagent's `model` + `tokens`.

**Cost:** prefer `preciseCostUsd` (statusline) for the session total when present. Per-agent /
per-model cost is an **estimate** from tokens × per-model rates in a small `model-pricing.ts` table
(labelled "est." in UI, matching mockup). Fail open: unknown model → tokens shown, no cost.

**View-model:** extend `session-view-model.ts` (Phase 1) with `model`/`spawnReason` per agent and an
`economics` block. Client gains `render-economics.ts`.

## Related Code Files

- Modify: `src/core/types.ts` (SubAgentState fields), `src/core/state-reducer.ts` (capture model +
  spawnReason)
- Create: `src/core/token-economics.ts`, `src/core/model-pricing.ts`
- Modify: `src/ui/webview-view/session-view-model.ts`; add
  `src/ui/webview-view-ui/render-economics.ts` + economics CSS block
- Modify: reducer + economics-helper tests

## Implementation Steps

1. Add optional `model` / `spawnReason` to `SubAgentState` + `emptySubAgentState`.
2. Capture `message.model` in `reduceSubAgentLine`; capture `input.description` in
   `upsertSubAgentFromTask`. Preserve the "sub-agent usage never feeds parent" invariant.
3. Write `token-economics.ts` (pure) + `model-pricing.ts`; unit-test cache % and rollups against a
   fixture transcript with known usage.
4. Extend the view-model; write `render-economics.ts` (stacked bar + rollup + cache line) per mockup.
5. Add model chip + spawn reason to `render-agents.ts`.
6. `npm run reinstall`; verify economics numbers against a real multi-agent session.

## Success Criteria

- [ ] Agent nodes show correct model + spawn reason for a real multi-agent session.
- [ ] Economics: stacked bar sums to total; per-model rollup sums to total; cache-savings % =
      `cacheRead / totalUsage` — verified against a fixture with hand-computed expected values.
- [ ] Session cost uses `preciseCostUsd` when present; per-agent cost labelled "est.".
- [ ] Unknown model → tokens shown, no crash, no cost.
- [ ] Reducer unit tests still green (no regression to `cumulativeUsage`); new tests added.
- [ ] Files < 200 lines; typecheck clean.

## Risk Assessment

- **Double-counting** — the reducer's documented invariant is that subagent usage must NOT feed
  parent `cumulativeUsage`. `tokenEconomics` sums them for *display* only; keep that summation in the
  economics helper, never in the reducer. Add a test asserting parent `cumulativeUsage` is unchanged
  by subagent lines.
- **Cost drift** — hard-coded pricing goes stale. Isolate in `model-pricing.ts`, label estimates,
  prefer the precise statusline total for the headline number.
