import { SessionState, TokenUsage } from "./types";

/**
 * One incremental tick for the dashboard's charts (Phase 5,
 * `ui/webview/charts.ts`) — token deltas + current context%/cost SINCE the
 * last diff computed for this session, never a full-history resend. Produced
 * by {@link computeMetricsDiffs} and fired on
 * `SessionStateStore.onDidChangeMetrics`, separate from the full-snapshot
 * `onDidChange` the tree-view/status-bar consume — adding this never changes
 * what those existing consumers receive.
 */
export interface SessionMetricsDiff {
  sessionId: string;
  timestamp: number;
  model: string | undefined;
  /** Token usage added since the previous diff for this session (zero-valued
   *  fields, not omitted, on the session's very first diff — that diff's
   *  delta equals its full cumulative usage so far). */
  usageDelta: TokenUsage;
  /** Precise context-window %, when the statusline wrap (Phase 4) is installed. */
  contextPercent: number | undefined;
  /** Precise cumulative session cost (USD), when the statusline wrap is installed. */
  costUsd: number | undefined;
}

/** Per-session snapshot of the last emitted diff's absolute values, used to
 *  compute the next delta and to detect "nothing changed" (skip emitting). */
export interface MetricsSnapshot {
  usage: TokenUsage;
  contextPercent: number | undefined;
  costUsd: number | undefined;
}

function subtractUsage(current: TokenUsage, previous: TokenUsage): TokenUsage {
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
    cacheReadInputTokens: current.cacheReadInputTokens - previous.cacheReadInputTokens,
  };
}

function isZeroUsage(usage: TokenUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheCreationInputTokens === 0 &&
    usage.cacheReadInputTokens === 0
  );
}

/**
 * Computes one {@link SessionMetricsDiff} per session that actually changed
 * (token usage, context%, or cost) since its last recorded snapshot in
 * `snapshots` — sessions with nothing new are skipped entirely, which is
 * what makes the resulting stream incremental rather than a full resend.
 * Mutates `snapshots` in place (records the new baseline for every session a
 * diff is emitted for) — the caller owns the map's lifetime.
 */
export function computeMetricsDiffs(
  states: Iterable<SessionState>,
  snapshots: Map<string, MetricsSnapshot>,
  now: number = Date.now()
): SessionMetricsDiff[] {
  const diffs: SessionMetricsDiff[] = [];

  for (const state of states) {
    const previous = snapshots.get(state.sessionId);
    const usageDelta = previous ? subtractUsage(state.cumulativeUsage, previous.usage) : state.cumulativeUsage;
    const contextChanged = !previous || previous.contextPercent !== state.preciseContextPercent;
    const costChanged = !previous || previous.costUsd !== state.preciseCostUsd;

    if (previous && isZeroUsage(usageDelta) && !contextChanged && !costChanged) {
      continue;
    }

    snapshots.set(state.sessionId, {
      usage: state.cumulativeUsage,
      contextPercent: state.preciseContextPercent,
      costUsd: state.preciseCostUsd,
    });
    diffs.push({
      sessionId: state.sessionId,
      timestamp: now,
      model: state.model,
      usageDelta,
      contextPercent: state.preciseContextPercent,
      costUsd: state.preciseCostUsd,
    });
  }

  return diffs;
}
