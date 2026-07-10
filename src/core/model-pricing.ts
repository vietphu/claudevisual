import { ModelTokenSlice } from "./token-economics";

/**
 * Rough per-model USD rates (per 1M tokens) for an ESTIMATED session cost when
 * the precise statusline-derived `cost.total_cost_usd` isn't available (the
 * statusline wrap is opt-in). Deliberately isolated + clearly an estimate:
 * hard-coded prices go stale, so callers must label any figure derived here as
 * "est." and always prefer `preciseCostUsd` when present.
 *
 * The economics rollup only tracks a single blended token total per model (it
 * doesn't separate input vs output vs cache), so we apply one blended rate per
 * model family — an order-of-magnitude estimate, not a billing figure.
 */
interface ModelRate {
  /** Blended USD per 1M tokens. */
  blendedPerMTok: number;
}

const RATES: Array<{ match: string; rate: ModelRate }> = [
  { match: "opus", rate: { blendedPerMTok: 9.0 } },
  { match: "sonnet", rate: { blendedPerMTok: 4.5 } },
  { match: "haiku", rate: { blendedPerMTok: 1.2 } },
  { match: "fable", rate: { blendedPerMTok: 4.5 } },
];

const DEFAULT_RATE: ModelRate = { blendedPerMTok: 4.5 };

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
 * Estimates total session cost (USD) from the per-model token rollup. Models
 * with no known rate (e.g. `"unknown"`) contribute their tokens but no cost, so
 * the estimate is conservative rather than fabricated. Returns undefined when
 * nothing could be priced at all.
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
