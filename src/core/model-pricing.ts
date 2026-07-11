import { SessionState, TokenUsage } from "./types";

/**
 * Rough per-model USD rates (per 1M tokens) for an ESTIMATED session cost when
 * the precise statusline-derived `cost.total_cost_usd` isn't available (the
 * statusline wrap is opt-in). Deliberately isolated + clearly an estimate:
 * hard-coded prices go stale, so callers must label any figure derived here as
 * "est." and always prefer `preciseCostUsd` when present.
 *
 * Real Anthropic pricing differs ~10× across input / output / cache-write /
 * cache-read, so every consumer prices the raw 4-bucket usage (from
 * `SessionState`) per bucket rather than collapsing to one flat rate — a
 * blended rate applied to a cache-read-heavy session (the common case for long
 * agentic sessions) would overstate cost substantially.
 */
interface ModelRate {
  /** Split USD per 1M tokens per bucket. Cache-write is a premium over base
   *  input; cache-read is a deep discount — the whole point of pricing the
   *  buckets separately is to make cache churn visible as real money. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

// Published USD/1M-token prices per bucket. cacheWrite ≈ 1.25× input,
// cacheRead ≈ 0.1× input — that spread is exactly what makes cache churn show
// up as real cost.
const RATES: Array<{ match: string; rate: ModelRate }> = [
  { match: "opus", rate: { inputPerMTok: 15.0, outputPerMTok: 75.0, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 } },
  { match: "sonnet", rate: { inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 } },
  { match: "haiku", rate: { inputPerMTok: 1.0, outputPerMTok: 5.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 } },
  { match: "fable", rate: { inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 } },
];

const DEFAULT_RATE: ModelRate = { inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 };

function rateFor(model: string): ModelRate | undefined {
  const lower = model.toLowerCase();
  for (const { match, rate } of RATES) {
    if (lower.includes(match)) {
      return rate;
    }
  }
  return model === "unknown" ? undefined : DEFAULT_RATE;
}

/** Per-bucket USD breakdown of an estimated cost. */
export interface CostBreakdown {
  totalUsd: number;
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
}

function priceUsage(usage: TokenUsage, r: ModelRate): CostBreakdown {
  const inputUsd = (usage.inputTokens / 1_000_000) * r.inputPerMTok;
  const outputUsd = (usage.outputTokens / 1_000_000) * r.outputPerMTok;
  const cacheWriteUsd = (usage.cacheCreationInputTokens / 1_000_000) * r.cacheWritePerMTok;
  const cacheReadUsd = (usage.cacheReadInputTokens / 1_000_000) * r.cacheReadPerMTok;
  return {
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
  };
}

/**
 * Prices raw 4-bucket usage per model with the split rates and sums into one
 * breakdown. Unpriceable models (`"unknown"`) contribute nothing but don't
 * null out the whole estimate. Returns undefined when nothing could be priced
 * at all.
 */
export function estimateCostFromUsage(
  entries: Array<{ model: string | undefined; usage: TokenUsage }>
): CostBreakdown | undefined {
  let priced = false;
  const acc: CostBreakdown = { totalUsd: 0, inputUsd: 0, outputUsd: 0, cacheWriteUsd: 0, cacheReadUsd: 0 };
  for (const { model, usage } of entries) {
    const r = rateFor(model ?? "unknown");
    if (!r) {
      continue;
    }
    priced = true;
    const b = priceUsage(usage, r);
    acc.totalUsd += b.totalUsd;
    acc.inputUsd += b.inputUsd;
    acc.outputUsd += b.outputUsd;
    acc.cacheWriteUsd += b.cacheWriteUsd;
    acc.cacheReadUsd += b.cacheReadUsd;
  }
  return priced ? acc : undefined;
}

/**
 * Convenience: split-rate cost estimate straight from a `SessionState`, pricing
 * the main session's usage (on `state.model`) plus every sub-agent's own usage
 * (on its own model). Undefined when nothing could be priced.
 */
export function estimateCostFromState(state: SessionState): number | undefined {
  const entries: Array<{ model: string | undefined; usage: TokenUsage }> = [
    { model: state.model, usage: state.cumulativeUsage },
  ];
  for (const agent of state.subagents.values()) {
    entries.push({ model: agent.model, usage: agent.tokens });
  }
  return estimateCostFromUsage(entries)?.totalUsd;
}
