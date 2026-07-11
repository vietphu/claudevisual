// All tunable knobs for the advisor in one place, each with the reasoning behind
// its value. Centralized so thresholds can be adjusted after real-session
// dogfooding without hunting through rule logic. No plan-artifact references —
// each comment explains the invariant, not where it came from.

/** Context-occupancy bands. Match the sidebar vitals meter (good/warn/crit) so the
 *  advisor and the context meter never disagree about "is this session in trouble". */
export const CONTEXT_WARN_PERCENT = 75;
export const CONTEXT_CRIT_PERCENT = 90;

/** Cache churn: cache-creation tokens are billed at a premium over cache-read.
 *  A high creation:read ratio means context is being re-written instead of reused
 *  (waste). Only flag once creation passes a floor so tiny early sessions (where the
 *  ratio is naturally high before any reuse accrues) don't trip it. */
export const CACHE_CHURN_RATIO = 1.5;
export const CACHE_CHURN_MIN_CREATION_TOKENS = 50_000;

/** Cache efficiency: below this reuse rate on a session with real spend, the user is
 *  likely re-sending context they could keep warm. Info-level nudge, not a warning. */
export const CACHE_LOW_SAVED_PCT = 25;
export const CACHE_LOW_MIN_TOTAL_TOKENS = 200_000;

/** A single sub-agent past this token spend is worth surfacing for ROI review —
 *  large fan-outs are fine, but one agent quietly burning this much often means a
 *  cheaper primitive (Grep/Read) would have done. */
export const SUBAGENT_EXPENSIVE_TOKENS = 150_000;

/** Model right-sizing (heuristic, phrased "consider" — never asserted). Only consider
 *  a downgrade suggestion when the session is on a top-tier model, has done real work,
 *  and its output share is low (little generation → the reasoning premium wasn't used).
 *  Gated conservatively to avoid false positives; validate against real transcripts. */
export const MODEL_RIGHTSIZE_MIN_TOTAL_TOKENS = 300_000;
export const MODEL_RIGHTSIZE_MAX_OUTPUT_SHARE = 0.05;

/** Cost projection only fires with a live burn rate and a known window with real
 *  headroom left — projecting from a stale/idle session would mislead. */
export const COST_PROJECTION_MIN_BURN_PER_MIN = 1_000;

/** Repeated compaction means the context window keeps overflowing — a strong sign
 *  the session should be split rather than compacted again. One compaction is
 *  routine; this many is thrash. */
export const FREQUENT_COMPACTION_COUNT = 2;

/** Efficiency Score dimension weights (sum ~1.0). Context health and cache efficiency
 *  dominate because they're the most actionable, high-frequency levers. */
export const SCORE_WEIGHTS = {
  context: 0.35,
  cache: 0.3,
  model: 0.15,
  orchestration: 0.2,
} as const;

/** Score→grade cutoffs (inclusive lower bounds). */
export const GRADE_CUTOFFS: Array<{ min: number; grade: string }> = [
  { min: 90, grade: "A" },
  { min: 80, grade: "B" },
  { min: 70, grade: "C" },
  { min: 60, grade: "D" },
  { min: 0, grade: "F" },
];

/** Below this total spend a session hasn't done enough to score meaningfully —
 *  the score is rendered neutral rather than punishing a just-started session. */
export const SCORE_MIN_TOTAL_TOKENS = 20_000;
