// Advisor DTOs. Plain serializable shapes (no Maps/Dates/class instances): these
// cross the host→webview boundary into the sidebar + dashboard clients, mirroring
// the discipline in `ui/webview-view/sidebar-messages.ts`. No `vscode` import.

import { TokenUsage } from "../types";
import { TokenEconomics } from "../token-economics";
import { BillingPlan, CostInterpretation } from "./advisor-config";

/** Ranked highest-to-lowest urgency. */
export type RecommendationSeverity = "critical" | "warn" | "info";

/** What kind of inefficiency a recommendation is about (drives its chip/icon). */
export type RecommendationCategory = "cost" | "context" | "cache" | "model" | "orchestration";

/** One actionable suggestion derived from a session's measured state. */
export interface Recommendation {
  /** Stable identifier for dedupe/throttle (status bar, notifications). Never a
   *  plan-artifact label — a self-contained slug describing the condition. */
  id: string;
  severity: RecommendationSeverity;
  category: RecommendationCategory;
  /** One-line headline shown in the list. */
  title: string;
  /** Optional longer explanation / the concrete action to take. */
  detail?: string;
  /** Optional supporting metric already formatted for display (e.g. "91%", "~3.2×"). */
  metric?: string;
}

/** One axis of the composite Efficiency Score. */
export interface ScoreDimension {
  key: "context" | "cache" | "model" | "orchestration";
  label: string;
  /** 0–100. */
  score: number;
}

/** Composite session efficiency rating. */
export interface EfficiencyScore {
  /** 0–100 weighted blend of the dimensions. */
  score: number;
  /** A–F, derived from `score`. */
  grade: string;
  dimensions: ScoreDimension[];
  /** True when the session has no measurable spend yet — score is a neutral
   *  placeholder, not a real assessment (callers should render it muted). */
  neutral: boolean;
}

/** Derived, rule-ready view of a session — the input every rule + the score read.
 *  Pure product of `buildAdvisorContext(state)`. */
export interface AdvisorContext {
  /** Billing plan — reframes cost language (subscription proxy vs billed money). */
  plan: BillingPlan;
  model: string | undefined;
  /** Resolved context occupancy (statusline-precise when available). */
  contextPercent: number;
  contextPrecise: boolean;
  contextUsedTokens: number;
  contextWindowTokens: number;
  /** Main-session cumulative usage (4 buckets). Sub-agent usage is separate. */
  mainUsage: TokenUsage;
  /** Main + every sub-agent's 4-bucket usage, summed (for churn/cache math). */
  totalUsage: TokenUsage;
  /** Display-folded economics (total tokens, cache read, byAgent/byModel). */
  economics: TokenEconomics;
  /** Ground-truth statusline cost when present, else split-rate estimate. */
  costUsd: number | undefined;
  costEstimated: boolean;
  burnRatePerMin: number | undefined;
  live: boolean;
  running: boolean;
  subAgentCount: number;
  /** `/compact` events seen this session — context-thrash indicator. */
  compactionCount: number;
  /** Most recent terminal `stop_reason` (`"max_tokens"` = truncated output). */
  lastStopReason: string | undefined;
}

/** Everything the advisor emits for one session. */
export interface AdvisorResult {
  score: EfficiencyScore;
  /** Severity-then-category ranked, most urgent first. */
  recommendations: Recommendation[];
  /** Plan-aware framing of the session's cost figure (undefined when no cost known). */
  cost?: CostInterpretation;
}
