// Pure derivation of an `AdvisorContext` from a `SessionState`. Reuses the same
// display helpers the sidebar uses (`resolveContextPercent`, `tokenEconomics`) and
// the same cost-resolution priority (precise statusline cost > split-rate estimate),
// so the advisor never disagrees with what the rest of the UI already shows.

import { addUsage, emptyUsage, SessionState, TokenUsage } from "../types";
import { resolveContextPercent } from "../session-display";
import { tokenEconomics } from "../token-economics";
import { estimateCostFromState } from "../model-pricing";
import { AdvisorContext } from "./advisor-types";
import { AdvisorConfig, DEFAULT_ADVISOR_CONFIG } from "./advisor-config";

/** Main-session usage + every sub-agent's usage, summed bucket-by-bucket. Sub-agent
 *  usage is deliberately kept OUT of the main `cumulativeUsage` by the reducer, so we
 *  re-fold it here (for churn/cache ratios) without mutating the source invariant. */
function totalUsage(state: SessionState): TokenUsage {
  let acc = state.cumulativeUsage;
  for (const agent of state.subagents.values()) {
    acc = addUsage(acc, agent.tokens);
  }
  return acc;
}

export function buildAdvisorContext(
  state: SessionState,
  config: AdvisorConfig = DEFAULT_ADVISOR_CONFIG
): AdvisorContext {
  const ctxPct = resolveContextPercent(state);
  const economics = tokenEconomics(state);
  const { costUsd, costEstimated } = resolveCost(state);
  return {
    plan: config.plan,
    thresholds: config.thresholds,
    model: state.model,
    contextPercent: ctxPct.percent,
    contextPrecise: ctxPct.precise,
    contextUsedTokens: ctxPct.usedTokens,
    contextWindowTokens: ctxPct.windowTokens,
    mainUsage: state.cumulativeUsage ?? emptyUsage(),
    totalUsage: totalUsage(state),
    economics,
    costUsd,
    costEstimated,
    burnRatePerMin: state.burnRatePerMin,
    live: state.isLive,
    running: state.running,
    subAgentCount: state.subagents.size,
    compactionCount: state.compactionCount,
    lastStopReason: state.lastStopReason,
  };
}

/** Same priority as `ui/webview-view/session-view-model.resolveCost`: the precise
 *  statusline cost is ground truth; otherwise a clearly-flagged estimate. */
function resolveCost(state: SessionState): { costUsd: number | undefined; costEstimated: boolean } {
  if (state.preciseCostUsd !== undefined) {
    return { costUsd: state.preciseCostUsd, costEstimated: false };
  }
  return { costUsd: estimateCostFromState(state), costEstimated: true };
}
