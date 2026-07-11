import { ModelTokenSlice } from "./token-economics";
import { SessionState, TokenUsage } from "./types";

/**
 * Rough per-model USD rates (per 1M tokens) for an ESTIMATED session cost when
 * the precise statusline-derived `cost.total_cost_usd` isn't available (the
 * statusline wrap is opt-in). Deliberately isolated + clearly an estimate:
 * hard-coded prices go stale, so callers must label any figure derived here as
 * "est." and always prefer `preciseCostUsd` when present.
 *
 * Two rate views live here:
 *  - `blendedPerMTok` — one flat rate over all buckets, for the legacy
 *    economics rollup which only tracks a single blended token total per model.
 *  - the split `*PerMTok` fields — real Anthropic pricing differs ~10× across
 *    input / output / cache-write / cache-read, so when the raw 4-bucket usage is
 *    available (from `SessionState`) we price each bucket separately for a much
 *    sharper estimate + a per-bucket breakdown.
 */
interface ModelRate {
  /** Blended USD per 1M tokens (legacy single-total path). */
  blendedPerMTok: number;
  /** Split USD per 1M tokens per bucket. Cache-write is a premium over base
   *  input; cache-read is a deep discount — the whole point of pricing the
   *  buckets separately is to make cache churn visible as real money. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

// Split rates below are the published USD/1M-token prices per bucket; `blended`
// keeps the legacy single-rate view. cacheWrite ≈ 1.25× input, cacheRead ≈ 0.1×
// input — that spread is exactly what makes cache churn show up as real cost.
const RATES: Array<{ match: string; rate: ModelRate }> = [
  { match: "opus", rate: { blendedPerMTok: 9.0, inputPerMTok: 15.0, outputPerMTok: 75.0, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 } },
  { match: "sonnet", rate: { blendedPerMTok: 4.5, inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 } },
  { match: "haiku", rate: { blendedPerMTok: 1.2, inputPerMTok: 1.0, outputPerMTok: 5.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 } },
  { match: "fable", rate: { blendedPerMTok: 4.5, inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 } },
];

const DEFAULT_RATE: ModelRate = { blendedPerMTok: 4.5, inputPerMTok: 3.0, outputPerMTok: 15.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 };

function rateFor(model: string): ModelRate | undefined {
  const lower = model.toLowerCase();
  for (const { match, rate } of RATES) {
    if (lower.includes(match)) {
      return rate;
    }
  }
  return model === "unknown" ? undefined : DEFAULT_RATE;
}

/**
 * Estimates total session cost (USD) from the per-model BLENDED token rollup.
 * Models with no known rate (e.g. `"unknown"`) contribute their tokens but no
 * cost, so the estimate is conservative rather than fabricated. Returns
 * undefined when nothing could be priced at all.
 */
export function estimateCostUsd(byModel: ModelTokenSlice[]): number | undefined {
  let cost = 0;
  let priced = false;
  for (const slice of byModel) {
    const rate = rateFor(slice.model);
    if (!rate) {
      continue;
    }
    priced = true;
    cost += (slice.tokens / 1_000_000) * rate.blendedPerMTok;
  }
  return priced ? cost : undefined;
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
 * breakdown. Unpriceable models (`"unknown"`) contribute nothing. Returns
 * undefined when nothing could be priced — same conservative contract as
 * {@link estimateCostUsd}.
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
