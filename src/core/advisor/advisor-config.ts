// Plan awareness. On a flat-fee subscription (Max / Pro) the per-token USD figure
// is NOT out-of-pocket money — it's the API-equivalent metered cost, useful only as a
// proxy for how much of a fixed usage budget a session is consuming. On the API plan
// it's real spend. The advisor reframes cost language accordingly; the efficiency
// analysis itself (context, cache, model-fit, orchestration) is plan-agnostic.

import { AdvisorThresholds, DEFAULT_ADVISOR_THRESHOLDS } from "./advisor-thresholds";

export type BillingPlan = "max" | "pro" | "api";

export interface AdvisorConfig {
  plan: BillingPlan;
  /** Per-rule trigger thresholds — overridable via `claudevisual.advisor.thresholds.*`. */
  thresholds: AdvisorThresholds;
}

/** Default matches the common Claude Code subscription case; overridable via the
 *  `claudevisual.advisor.plan` and `claudevisual.advisor.thresholds.*` settings. */
export const DEFAULT_ADVISOR_CONFIG: AdvisorConfig = { plan: "max", thresholds: DEFAULT_ADVISOR_THRESHOLDS };

/** True for flat-fee subscriptions where a dollar figure is a consumption proxy,
 *  not billed spend. */
export function isSubscription(plan: BillingPlan): boolean {
  return plan === "max" || plan === "pro";
}

/** How to present a session's USD figure for the given plan — a pure helper the UI
 *  layers share so cost is framed identically everywhere. `costUsd` undefined →
 *  nothing to show. */
export interface CostInterpretation {
  /** Short display string, e.g. "≈ $1.20 API-equiv." (subscription) or "$1.20" (api). */
  display: string;
  /** One-line explanation for a tooltip. */
  tooltip: string;
  /** Whether the figure is a consumption proxy rather than billed money. */
  proxy: boolean;
}

export function interpretCost(
  plan: BillingPlan,
  costUsd: number | undefined,
  estimated: boolean
): CostInterpretation | undefined {
  if (costUsd === undefined) {
    return undefined;
  }
  const dollars = `$${costUsd.toFixed(2)}`;
  const est = estimated ? " est." : "";
  if (isSubscription(plan)) {
    return {
      display: `≈ ${dollars}${est} API-equiv.`,
      tooltip:
        "You're on a flat-fee plan, so this isn't billed money — it's the equivalent metered API cost, a proxy for how much of your usage budget this session consumes. Lower it by cutting cache churn and context waste.",
      proxy: true,
    };
  }
  return {
    display: `${dollars}${est}`,
    tooltip: estimated
      ? "Estimated from a per-model rate table (statusline wrap not installed) — install it for the precise billed cost."
      : "Precise billed cost from the statusline.",
    proxy: false,
  };
}
