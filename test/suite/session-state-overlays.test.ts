import { strict as assert } from "assert";
import {
  applyHookEventOverlay,
  applyStatuslineOverlay,
  applySubagentMetaOverlay,
} from "../../src/core/session-state-overlays";
import { emptySessionState } from "../../src/core/types";

describe("session-state-overlays", () => {
  describe("applyHookEventOverlay", () => {
    it("synthesizes a placeholder session when the hook event wins the race", () => {
      const state = applyHookEventOverlay(undefined, { ts: 100, sessionId: "s1", hookEvent: "UserPromptSubmit" });
      assert.equal(state.sessionId, "s1");
      assert.equal(state.running, true);
      assert.equal(state.lastHookEvent, "UserPromptSubmit");
    });

    it("overlays running state onto a known session without clobbering other fields", () => {
      const previous = { ...emptySessionState("s1", "/p"), model: "claude-sonnet-5" };
      const state = applyHookEventOverlay(previous, { ts: 200, sessionId: "s1", hookEvent: "Stop" });
      assert.equal(state.running, false);
      assert.equal(state.model, "claude-sonnet-5");
    });
  });

  describe("applyStatuslineOverlay", () => {
    it("overlays precise context% and cost", () => {
      const previous = emptySessionState("s1", "/p");
      const state = applyStatuslineOverlay(previous, { sessionId: "s1", ts: 100, contextUsedPercent: 42, costUsd: 1.5 });
      assert.equal(state.preciseContextPercent, 42);
      assert.equal(state.preciseCostUsd, 1.5);
    });
  });

  describe("applySubagentMetaOverlay", () => {
    it("creates a sub-agent entry from meta when the session is already known", () => {
      const previous = emptySessionState("s1", "/p");
      const state = applySubagentMetaOverlay(previous, "s1", "real-agent-id", {
        agentType: "researcher",
        description: "research auth sessions",
        toolUseId: "toolu_abc123",
      });
      const agent = state.subagents.get("real-agent-id");
      assert.equal(agent?.subagentType, "researcher");
      assert.equal(agent?.spawnReason, "research auth sessions");
      assert.equal(agent?.toolUseId, "toolu_abc123");
      assert.equal(agent?.status, "running");
    });

    it("synthesizes a placeholder session when the meta sidecar wins the race", () => {
      const state = applySubagentMetaOverlay(undefined, "s1", "real-agent-id", { agentType: "researcher" });
      assert.equal(state.sessionId, "s1");
      assert.equal(state.subagents.get("real-agent-id")?.subagentType, "researcher");
    });

    it("enriches an out-of-order 'unknown' placeholder created by the agent's own transcript line", () => {
      // The sub-agent's own transcript can be tailed before its meta sidecar is
      // read, creating a placeholder typed "unknown" with real token data.
      const withTokens = emptySessionState("s1", "/p");
      withTokens.subagents.set("real-agent-id", {
        agentId: "real-agent-id",
        subagentType: "unknown",
        status: "running",
        tokens: { inputTokens: 10, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        startedAt: 1,
        lastUpdatedAt: 1,
        recentToolCalls: [],
      });

      const state = applySubagentMetaOverlay(withTokens, "s1", "real-agent-id", {
        agentType: "researcher",
        description: "research auth",
      });
      const agent = state.subagents.get("real-agent-id");
      assert.equal(agent?.subagentType, "researcher");
      assert.equal(agent?.spawnReason, "research auth");
      // already-accumulated tokens are preserved through enrichment.
      assert.equal(agent?.tokens.inputTokens, 10);
    });

    it("records parentAgentId for nesting", () => {
      const previous = emptySessionState("s1", "/p");
      const state = applySubagentMetaOverlay(previous, "s1", "child-id", {
        agentType: "Explore",
        parentAgentId: "parent-id",
      });
      assert.equal(state.subagents.get("child-id")?.parentAgentId, "parent-id");
    });

    it("never clobbers a known field with an absent one on a later, partial meta read", () => {
      const previous = applySubagentMetaOverlay(emptySessionState("s1", "/p"), "s1", "a1", {
        agentType: "researcher",
        description: "dig docs",
      });
      const state = applySubagentMetaOverlay(previous, "s1", "a1", {});
      assert.equal(state.subagents.get("a1")?.subagentType, "researcher");
      assert.equal(state.subagents.get("a1")?.spawnReason, "dig docs");
    });
  });
});
