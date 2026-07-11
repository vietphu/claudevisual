import { strict as assert } from "assert";
import { toSidebarViewModel } from "../../src/ui/webview-view/session-view-model";
import { emptySessionState, emptySubAgentState } from "../../src/core/types";

describe("session-view-model: agent tree, drill-down, heartbeat", () => {
  it("maps sub-agents to rows with summed tokens and a color index", () => {
    const state = emptySessionState("s1", "/p");
    const agent = emptySubAgentState("agent-x", "researcher", 1000);
    agent.status = "completed";
    agent.tokens = { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 1, cacheReadInputTokens: 4 };
    state.subagents.set("agent-x", agent);

    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.agents.length, 1);
    assert.equal(vm.agents[0].type, "researcher");
    assert.equal(vm.agents[0].status, "completed");
    assert.equal(vm.agents[0].tokens, 20);
    assert.ok(vm.agents[0].colorIndex >= 1);
  });

  it("builds agent drill-down detail and a merged, agent-colored heartbeat", () => {
    const state = emptySessionState("s1", "/p");
    state.recentToolCalls = [
      { name: "Bash", detail: "npm test", timestamp: 100 },
      { name: "Edit", detail: "src/a.ts", timestamp: 300 },
    ];
    const agent = emptySubAgentState("agent-x", "researcher", 1);
    agent.recentToolCalls = [{ name: "Read", detail: "docs/x.md", timestamp: 200 }];
    state.subagents.set("agent-x", agent);

    const vm = toSidebarViewModel([state]).sessions[0];

    // drill-down: the agent's own call + derived file
    assert.equal(vm.agents[0].detail.calls[0].name, "Read");
    assert.equal(vm.agents[0].detail.files[0].base, "x.md");

    // heartbeat: merged + ordered by real ts (100 main, 200 agent, 300 main)
    assert.equal(vm.heartbeat.length, 3);
    assert.equal(vm.heartbeat[0], 0); // main identity color = index 0
    assert.notEqual(vm.heartbeat[1], 0); // sub-agent color != main
    assert.equal(vm.heartbeat[2], 0);
  });

  it("has an empty heartbeat when the session has no tool calls", () => {
    const vm = toSidebarViewModel([emptySessionState("s1", "/p")]).sessions[0];
    assert.equal(vm.heartbeat.length, 0);
  });

  it("renders agents as a depth-tagged tree with an honest running call count", () => {
    const state = emptySessionState("s1", "/p");
    const planner = emptySubAgentState("planner", "planner", 1);
    planner.status = "completed";
    const r1 = emptySubAgentState("r1", "researcher", 2);
    r1.parentAgentId = "planner";
    r1.recentToolCalls = [
      { name: "Grep", detail: "auth", timestamp: 10 },
      { name: "Read", detail: "src/a.ts", timestamp: 20 },
    ];
    state.subagents.set("planner", planner);
    state.subagents.set("r1", r1);

    const vm = toSidebarViewModel([state]).sessions[0];
    // pre-order: planner (depth 0) then its child r1 (depth 1)
    assert.deepEqual(
      vm.agents.map((a) => `${a.type}@${a.depth}`),
      ["planner@0", "researcher@1"]
    );
    // running researcher surfaces its observed call count; completed planner reports 0
    assert.equal(vm.agents[1].calls, 2);
    assert.equal(vm.agents[0].calls, 0);
  });

  it("adds a main-only root node to the tree once sub-agents exist", () => {
    const empty = toSidebarViewModel([emptySessionState("s1", "/p")]).sessions[0];
    assert.equal(empty.mainAgent, undefined);

    const state = emptySessionState("s1", "/p");
    state.model = "claude-opus-4-8";
    state.cumulativeUsage = { inputTokens: 30, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 68 };
    const agent = emptySubAgentState("a1", "researcher", 1);
    agent.tokens = { inputTokens: 500, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    state.subagents.set("a1", agent);

    const vm = toSidebarViewModel([state]).sessions[0];
    assert.ok(vm.mainAgent);
    assert.equal(vm.mainAgent?.type, "main");
    assert.equal(vm.mainAgent?.model, "claude-opus-4-8");
    // main node shows main-only spend (100), NOT the sub-agent's 500.
    assert.equal(vm.mainAgent?.tokens, 100);
    assert.equal(vm.agents.length, 1);
  });

  it("derives an agent duration from its tool-call span, undefined for a single call", () => {
    const state = emptySessionState("s1", "/p");
    const solo = emptySubAgentState("solo", "researcher", 1);
    solo.status = "completed";
    solo.recentToolCalls = [{ name: "Read", detail: "a.ts", timestamp: 1000 }];
    const spanned = emptySubAgentState("spanned", "tester", 2);
    spanned.status = "completed";
    spanned.recentToolCalls = [
      { name: "Read", detail: "a.ts", timestamp: 10_000 },
      { name: "Bash", detail: "npm test", timestamp: 130_000 },
    ];
    state.subagents.set("solo", solo);
    state.subagents.set("spanned", spanned);

    const byId = Object.fromEntries(toSidebarViewModel([state]).sessions[0].agents.map((a) => [a.agentId, a]));
    assert.equal(byId["solo"].durationMs, undefined);
    assert.equal(byId["spanned"].durationMs, 120_000);
  });
});
