import { SessionState } from "./types";

/**
 * Pure display-shaping helpers shared by every session-facing surface (status
 * bar, sidebar webview). Kept vscode-free so the sidebar's view-model can reuse
 * them and both consumers stay unit-testable without the editor host.
 */

/**
 * Published max context-window size (tokens) per current model, used as the
 * fallback denominator until a precise statusLine-derived window size is
 * available for this session. This is the model's *maximum* window — a given
 * session's actual granted window can be smaller (e.g. without an
 * extended-context beta enabled), so `preciseContextWindowSize` still takes
 * priority in `resolveContextPercent` whenever it's known.
 */
const MODEL_CONTEXT_WINDOW_SIZE: Record<string, number> = {
  "claude-fable-5": 1_000_000,
  "claude-mythos-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};

/** Fallback for models not in the table above (older/legacy models, or a
 *  future model this table hasn't been updated for yet). */
const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;

/** Sum of every usage bucket this session — the "total spend" proxy. */
export function sumUsage(state: SessionState): number {
  const u = state.cumulativeUsage;
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/**
 * Prefers the statusline wrap's precise `context_window.used_percentage` over
 * the JSONL-derived `lastTurnContextTokens` approximation when present.
 * `precise: false` is the only case that should render a `~` prefix.
 *
 * The fallback's denominator prefers `preciseContextWindowSize` — the real window
 * size learned from an earlier statusline tick this session — over the hardcoded
 * per-model table, since the real window varies per session (extended-context
 * betas can push it well past the 200k/1M defaults below) and guessing wrong
 * either overstates or understates the percentage.
 */
export function resolveContextPercent(state: SessionState): { percent: number; precise: boolean } {
  if (state.preciseContextPercent !== undefined) {
    return { percent: Math.round(state.preciseContextPercent), precise: true };
  }
  const windowSize =
    state.preciseContextWindowSize ??
    (state.model ? MODEL_CONTEXT_WINDOW_SIZE[state.model] ?? DEFAULT_CONTEXT_WINDOW_SIZE : DEFAULT_CONTEXT_WINDOW_SIZE);
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
