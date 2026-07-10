// Host-side chart data shaping — pure functions only, no `vscode` import.
// Actual canvas drawing happens in the browser-context
// `../webview-ui/chart-view.ts` (the extension host has no DOM). Only
// `import type` is used for the one cross-boundary type this file needs, so
// it never pulls `vscode` into anything that re-exports from here (see
// messages.ts's header comment).
import type { SessionMetricsDiff } from "../../core/session-state-store";

/** One renderable data point for the dashboard's charts — a flattened,
 *  webview-postable projection of one `SessionMetricsDiff` tick. Kept as its
 *  own shape (not the raw `SessionMetricsDiff`) so nothing under
 *  `core/` (which imports `vscode`) needs to be reachable from the
 *  webview-ui esbuild entry, even at the type level for runtime values. */
export interface ChartPoint {
  sessionId: string;
  timestamp: number;
  model: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Session's precise context-window %, when the statusline wrap (Phase 4) is installed. */
  contextPercent: number | undefined;
  /** Session's precise cumulative cost (USD) so far, when the statusline wrap is installed. */
  costUsd: number | undefined;
}

/**
 * Projects incremental session-metrics diffs (`session-state-store.ts`) into
 * the flat point shape above. A straight 1:1 map — the "no full-history
 * resend" requirement is already satisfied upstream by the store only
 * emitting a diff per session when something actually changed since the
 * last tick; this function never re-derives history, only reshapes what
 * it's handed.
 */
export function buildChartPoints(diffs: readonly SessionMetricsDiff[]): ChartPoint[] {
  return diffs.map((diff) => ({
    sessionId: diff.sessionId,
    timestamp: diff.timestamp,
    model: diff.model,
    inputTokens: diff.usageDelta.inputTokens,
    outputTokens: diff.usageDelta.outputTokens,
    cacheReadTokens: diff.usageDelta.cacheReadInputTokens,
    cacheCreationTokens: diff.usageDelta.cacheCreationInputTokens,
    contextPercent: diff.contextPercent,
    costUsd: diff.costUsd,
  }));
}
