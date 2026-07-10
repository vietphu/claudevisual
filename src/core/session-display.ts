import { DEFAULT_CONTEXT_WINDOW_SIZE, MODEL_CONTEXT_WINDOW_SIZE, SessionState } from "./types";

/**
 * Pure display-shaping helpers shared by every session-facing surface (status
 * bar, sidebar webview). Kept vscode-free so the sidebar's view-model can reuse
 * them and both consumers stay unit-testable without the editor host.
 */

/** Sum of every usage bucket this session — the "total spend" proxy. */
export function sumUsage(state: SessionState): number {
  const u = state.cumulativeUsage;
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/**
 * Prefers the statusline wrap's precise `context_window.used_percentage` over
 * the JSONL-derived `lastTurnContextTokens` approximation when present.
 * `precise: false` is the only case that should render a `~` prefix.
 */
export function resolveContextPercent(state: SessionState): { percent: number; precise: boolean } {
  if (state.preciseContextPercent !== undefined) {
    return { percent: Math.round(state.preciseContextPercent), precise: true };
  }
  const windowSize = state.model
    ? MODEL_CONTEXT_WINDOW_SIZE[state.model] ?? DEFAULT_CONTEXT_WINDOW_SIZE
    : DEFAULT_CONTEXT_WINDOW_SIZE;
  return { percent: Math.min(100, Math.round((state.lastTurnContextTokens / windowSize) * 100)), precise: false };
}

/** Compact human token count: `29.6M`, `84.0k`, `512`. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return `${n}`;
}
