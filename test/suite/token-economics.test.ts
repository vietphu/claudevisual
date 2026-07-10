import { strict as assert } from "assert";
import { tokenEconomics } from "../../src/core/token-economics";
import { emptySessionState, emptySubAgentState, TokenUsage } from "../../src/core/types";

function usage(input: number, output: number, cacheCreate: number, cacheRead: number): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: cacheCreate,
    cacheReadInputTokens: cacheRead,
  };
}

describe("token-economics", () => {
  it("returns zeros for an empty session", () => {
    const e = tokenEconomics(emptySessionState("s1", "/p"));
    assert.equal(e.totalTokens, 0);
    assert.equal(e.cacheSavedPct, 0);
    assert.equal(e.byAgent.length, 0);
    assert.equal(e.byModel.length, 0);
  });

  it("folds main + sub-agents, rolls up by model, computes cache savings", () => {
    const state = emptySessionState("s1", "/p");
    state.model = "claude-opus-4-8";
    state.cumulativeUsage = usage(20, 10, 0, 70); // 100, cacheRead 70

    const a1 = emptySubAgentState("a1", "researcher");
    a1.model = "claude-sonnet-5";
    a1.tokens = usage(10, 5, 0, 85); // 100, cacheRead 85

    const a2 = emptySubAgentState("a2", "tester");
    a2.model = "claude-sonnet-5";
    a2.tokens = usage(40, 10, 0, 0); // 50, cacheRead 0
    state.subagents.set("a1", a1);
    state.subagents.set("a2", a2);

    const e = tokenEconomics(state);
    assert.equal(e.totalTokens, 250);
    assert.equal(e.cacheReadTokens, 155);
    assert.equal(e.cacheSavedPct, Math.round((155 / 250) * 100));

    // byAgent: main + 2 agents, summing to total.
    assert.equal(e.byAgent.length, 3);
    assert.equal(e.byAgent[0].label, "main");
    assert.equal(e.byAgent.reduce((n, a) => n + a.tokens, 0), 250);

    // byModel: opus 100, sonnet 150 — sorted by tokens desc.
    assert.equal(e.byModel[0].model, "claude-sonnet-5");
    assert.equal(e.byModel[0].tokens, 150);
    assert.equal(e.byModel[1].model, "claude-opus-4-8");
    assert.equal(e.byModel[1].tokens, 100);
  });

  it("buckets agents with no captured model under 'unknown'", () => {
    const state = emptySessionState("s1", "/p");
    const a = emptySubAgentState("a1", "researcher");
    a.tokens = usage(10, 0, 0, 0);
    state.subagents.set("a1", a);
    const e = tokenEconomics(state);
    assert.equal(e.byModel[0].model, "unknown");
    assert.equal(e.byModel[0].tokens, 10);
  });

  it("omits the main slice when the main session has no spend", () => {
    const state = emptySessionState("s1", "/p");
    const a = emptySubAgentState("a1", "researcher");
    a.tokens = usage(10, 0, 0, 0);
    state.subagents.set("a1", a);
    const e = tokenEconomics(state);
    assert.equal(e.byAgent.length, 1);
    assert.equal(e.byAgent[0].agentId, "a1");
  });
});
