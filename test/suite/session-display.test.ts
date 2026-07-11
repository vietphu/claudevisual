import { strict as assert } from "assert";
import { resolveContextPercent } from "../../src/core/session-display";
import { emptySessionState } from "../../src/core/types";

describe("session-display", () => {
  describe("resolveContextPercent", () => {
    it("uses the statusline's precise used-tokens/window/percent verbatim when present", () => {
      // Real payload shape (`context_window.total_input_tokens`/`context_window_size`/
      // `used_percentage`), from an actual terminal statusline tick.
      const state = {
        ...emptySessionState("s1", "/p"),
        preciseContextPercent: 20,
        preciseContextWindowSize: 200_000,
        preciseContextUsedTokens: 40_955,
      };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 20, precise: true, usedTokens: 40_955, windowTokens: 200_000 });
    });

    it("reconstructs used-tokens from the rounded percent when the cache payload predates total_input_tokens", () => {
      const state = { ...emptySessionState("s1", "/p"), preciseContextPercent: 9 };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 9, precise: true, usedTokens: 18_000, windowTokens: 200_000 });
    });

    it("falls back to the model's published 1M window for current-generation models", () => {
      // Real case: this session's own %CONTEXT stayed on the fallback path all
      // night (no statusLine tick ever reached it), but claude-sonnet-5 publishes
      // a 1M window, so the table-driven fallback lands close to the real 16-19%
      // the native popup reported, instead of the old flat-200k ~78%/~94%.
      const state = { ...emptySessionState("s1", "/p"), model: "claude-sonnet-5", lastTurnContextTokens: 155_300 };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 16, precise: false, usedTokens: 155_300, windowTokens: 1_000_000 });
    });

    it("falls back to the hardcoded 200k default for a model absent from the table", () => {
      const state = { ...emptySessionState("s1", "/p"), model: "claude-legacy-mystery", lastTurnContextTokens: 82_000 };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 41, precise: false, usedTokens: 82_000, windowTokens: 200_000 });
    });

    it("prefers a previously learned real window size over the model table", () => {
      // Real case: the terminal test session's own statusLine tick reported
      // context_window_size: 200000 for claude-sonnet-4-6 — smaller than that
      // model's published 1M max, because no extended-context beta was enabled.
      const state = {
        ...emptySessionState("s1", "/p"),
        model: "claude-sonnet-4-6",
        lastTurnContextTokens: 40_955,
        preciseContextWindowSize: 200_000,
      };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 20, precise: false, usedTokens: 40_955, windowTokens: 200_000 });
    });

    it("still caps at 100% when the last turn genuinely exceeds the known window", () => {
      const state = {
        ...emptySessionState("s1", "/p"),
        lastTurnContextTokens: 1_200_000,
        preciseContextWindowSize: 967_000,
      };
      const result = resolveContextPercent(state);
      assert.deepEqual(result, { percent: 100, precise: false, usedTokens: 1_200_000, windowTokens: 967_000 });
    });
  });
});
