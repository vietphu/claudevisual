// The advisor entry point. `analyzeSession(state)` is the one function the rest of
// the extension calls: build the derived context, run every rule, rank the surviving
// recommendations, and compute the composite score. Pure + vscode-free — the UI
// layers (sidebar, dashboard, status bar) all consume its `AdvisorResult`.

import { SessionState } from "../types";
import { buildAdvisorContext } from "./advisor-context";
import { ADVISOR_RULES } from "./advisor-rules";
import { efficiencyScore } from "./efficiency-score";
import { AdvisorContext, AdvisorResult, Recommendation, RecommendationSeverity } from "./advisor-types";
import { AdvisorConfig, DEFAULT_ADVISOR_CONFIG, interpretCost } from "./advisor-config";

const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/** Runs the rule set over a pre-built context. Exposed separately so tests (and the
 *  score) can share one context without rebuilding it. */
export function runRules(ctx: AdvisorContext): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const rule of ADVISOR_RULES) {
    const rec = rule(ctx);
    if (rec) {
      recs.push(rec);
    }
  }
  return recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function analyzeSession(
  state: SessionState,
  config: AdvisorConfig = DEFAULT_ADVISOR_CONFIG
): AdvisorResult {
  const ctx = buildAdvisorContext(state, config);
  return {
    score: efficiencyScore(ctx),
    recommendations: runRules(ctx),
    cost: interpretCost(config.plan, ctx.costUsd, ctx.costEstimated),
  };
}
