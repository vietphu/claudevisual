import { strict as assert } from "assert";
import { parseHookEventLine, parseStatuslineCache } from "../../src/core/hook-event-parsing";

describe("hook-event-parsing", () => {
  describe("parseHookEventLine", () => {
    it("parses a SessionStart record's source field", () => {
      const line = JSON.stringify({
        ts: 1_700_000_000_000,
        sessionId: "s1",
        hookEvent: "SessionStart",
        source: "clear",
      });

      const result = parseHookEventLine(line);
      assert.equal(result?.hookEvent, "SessionStart");
      assert.equal(result?.source, "clear");
    });

    it("leaves source undefined when absent (every non-SessionStart event)", () => {
      const line = JSON.stringify({ ts: 1, sessionId: "s1", hookEvent: "PreToolUse" });
      assert.equal(parseHookEventLine(line)?.source, undefined);
    });

    it("drops a non-string source rather than throwing", () => {
      const line = JSON.stringify({ ts: 1, sessionId: "s1", source: 42 });
      assert.equal(parseHookEventLine(line)?.source, undefined);
    });
  });

  describe("parseStatuslineCache", () => {
    it("parses a real statusline payload's context_window fields, including total_input_tokens", () => {
      const raw = JSON.stringify({
        session_id: "bf68e2de-9916-46f1-ab97-13e97e1b2e28",
        model: { id: "claude-sonnet-4-6" },
        cost: { total_cost_usd: 0.156228 },
        context_window: {
          total_input_tokens: 40_955,
          context_window_size: 200_000,
          used_percentage: 20,
        },
      });

      const result = parseStatuslineCache(raw);
      assert.equal(result?.sessionId, "bf68e2de-9916-46f1-ab97-13e97e1b2e28");
      assert.equal(result?.contextUsedPercent, 20);
      assert.equal(result?.contextWindowSize, 200_000);
      assert.equal(result?.contextUsedTokens, 40_955);
      assert.equal(result?.costUsd, 0.156228);
    });

    it("leaves contextUsedTokens undefined when total_input_tokens is absent (older cache payload)", () => {
      const raw = JSON.stringify({
        session_id: "s1",
        context_window: { used_percentage: 9 },
      });

      const result = parseStatuslineCache(raw);
      assert.equal(result?.contextUsedPercent, 9);
      assert.equal(result?.contextUsedTokens, undefined);
    });

    it("returns undefined for malformed payloads without throwing", () => {
      assert.equal(parseStatuslineCache("not json"), undefined);
      assert.equal(parseStatuslineCache(""), undefined);
      assert.equal(parseStatuslineCache(JSON.stringify({ no_session_id: true })), undefined);
    });
  });
});
