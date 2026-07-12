// Composite Efficiency Score: blends four independent dimension scores (each 0–100)
// into one rating + letter grade. Pure and deterministic. A just-started session with
// negligible spend scores as `neutral` rather than being punished for having no data.

import { AdvisorContext, EfficiencyScore, ScoreDimension } from "./advisor-types";
import { GRADE_CUTOFFS, SCORE_MIN_TOTAL_TOKENS, SCORE_WEIGHTS } from "./advisor-thresholds";

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function usageTotal(u: AdvisorContext["totalUsage"]): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/** Full below the warn band = 100; degrades to 0 as it crosses from warn → crit and
 *  beyond, so context pressure dominates the score exactly when it matters. */
function contextScore(ctx: AdvisorContext): number {
  const p = ctx.contextPercent;
  const { contextWarnPercent: warn, contextCritPercent: crit } = ctx.thresholds;
  if (p <= warn) {
    return 100;
  }
  if (p >= crit) {
    // Keep sliding toward 0 past crit rather than flooring, so 99% scores worse than 90%.
    const over = (p - crit) / (100 - crit);
    return clamp(40 * (1 - over));
  }
  const band = (p - warn) / (crit - warn);
  return clamp(100 - 60 * band); // 100 at warn → 40 at crit
}

/** Reuse rate is the base; a high write:read churn ratio pulls it down (premium
 *  cache-write spend is the real waste, not just "low reuse"). */
function cacheScore(ctx: AdvisorContext): number {
  const base = ctx.economics.cacheSavedPct; // 0–100
  const created = ctx.totalUsage.cacheCreationInputTokens;
  const read = ctx.totalUsage.cacheReadInputTokens;
  const ratio = created / Math.max(read, 1);
  const churnRatio = ctx.thresholds.cacheChurnRatio;
  const churnPenalty = ratio > churnRatio ? Math.min(40, (ratio - churnRatio) * 20) : 0;
  return clamp(base - churnPenalty);
}

/** Rewards a model matched to its workload. Only Opus-on-read-heavy work is
 *  penalized (the one case the right-sizing rule flags); everything else is full. */
function modelScore(ctx: AdvisorContext): number {
  if (!ctx.model || !ctx.model.toLowerCase().includes("opus")) {
    return 100;
  }
  const total = usageTotal(ctx.totalUsage);
  if (total < SCORE_MIN_TOTAL_TOKENS) {
    return 100;
  }
  const outputShare = ctx.totalUsage.outputTokens / Math.max(total, 1);
  return outputShare <= ctx.thresholds.modelRightsizeMaxOutputShare ? 55 : 100;
}

/** Penalizes a single sub-agent dominating spend past the "expensive" bar; light
 *  fan-outs and balanced orchestration score full. */
function orchestrationScore(ctx: AdvisorContext): number {
  const subAgents = ctx.economics.byAgent.filter((a) => a.agentId !== "main");
  if (subAgents.length === 0) {
    return 100;
  }
  const worst = Math.max(...subAgents.map((a) => a.tokens));
  const cap = ctx.thresholds.subagentExpensiveTokens;
  if (worst < cap) {
    return 100;
  }
  const over = (worst - cap) / cap;
  return clamp(80 - Math.min(50, over * 50));
}

function gradeFor(score: number): string {
  for (const { min, grade } of GRADE_CUTOFFS) {
    if (score >= min) {
      return grade;
    }
  }
  return "F";
}

export function efficiencyScore(ctx: AdvisorContext): EfficiencyScore {
  const dimensions: ScoreDimension[] = [
    { key: "context", label: "Context health", score: contextScore(ctx) },
    { key: "cache", label: "Cache efficiency", score: cacheScore(ctx) },
    { key: "model", label: "Model fit", score: modelScore(ctx) },
    { key: "orchestration", label: "Orchestration", score: orchestrationScore(ctx) },
  ];

  const neutral = usageTotal(ctx.totalUsage) < SCORE_MIN_TOTAL_TOKENS;
  const blended =
    dimensions.reduce((sum, d) => sum + d.score * SCORE_WEIGHTS[d.key], 0) /
    Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  const score = neutral ? 100 : clamp(blended);

  return { score, grade: gradeFor(score), dimensions, neutral };
}
