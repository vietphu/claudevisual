import { strict as assert } from "assert";
import { toSidebarViewModel } from "../../src/ui/webview-view/session-view-model";
import { emptySessionState, emptySubAgentState, SessionState, ToolCallRecord } from "../../src/core/types";

export function withCalls(state: SessionState, calls: ToolCallRecord[]): SessionState {
  return { ...state, recentToolCalls: calls };
}

describe("session-view-model", () => {
  it("maps vitals: tokens, approx context %, and agent count", () => {
    const state = emptySessionState("session-abcdef12", "/Users/test/proj");
    state.model = "claude-sonnet-5";
    state.cumulativeUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 40,
    };
    state.lastTurnContextTokens = 500_000; // 50% of claude-sonnet-5's published 1M window

    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.shortId, "session-");
    assert.equal(vm.totalTokens, 200);
    assert.equal(vm.contextPercent, 50);
    assert.equal(vm.contextPrecise, false);
    assert.equal(vm.model, "claude-sonnet-5");
    // No statusline cost -> falls back to a pricing-table estimate.
    assert.equal(vm.costEstimated, true);
    assert.ok(vm.costUsd !== undefined && vm.costUsd > 0);
  });

  it("passes the reducer-derived title through, undefined when never set", () => {
    const withTitle = emptySessionState("session-1", "/Users/test/proj");
    withTitle.title = "Fix flaky login test";
    const withoutTitle = emptySessionState("session-2", "/Users/test/proj");

    const [vmWithTitle, vmWithoutTitle] = toSidebarViewModel([withTitle, withoutTitle]).sessions;
    assert.equal(vmWithTitle.title, "Fix flaky login test");
    assert.equal(vmWithoutTitle.title, undefined);
  });

  it("prefers precise context % and cost when present", () => {
    const state = emptySessionState("s1", "/p");
    state.preciseContextPercent = 87.6;
    state.preciseCostUsd = 1.48;
    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.contextPercent, 88);
    assert.equal(vm.contextPrecise, true);
    assert.equal(vm.costUsd, 1.48);
    assert.equal(vm.costEstimated, false);
  });

  it("surfaces per-agent model + spawn reason and builds the economics rollup", () => {
    const state = emptySessionState("s1", "/p");
    state.model = "claude-opus-4-8";
    state.cumulativeUsage = { inputTokens: 30, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 68 };
    const agent = emptySubAgentState("agent-x", "researcher", 1000);
    agent.model = "claude-sonnet-5";
    agent.spawnReason = "research auth sessions";
    agent.tokens = { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 85 };
    state.subagents.set("agent-x", agent);

    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.agents[0].model, "claude-sonnet-5");
    assert.equal(vm.agents[0].spawnReason, "research auth sessions");

    const e = vm.economics;
    assert.equal(e.totalTokens, 200); // 100 main + 100 agent
    assert.equal(e.byAgent.length, 2);
    assert.equal(e.byAgent.reduce((n, a) => n + a.tokens, 0), 200);
    assert.equal(e.byModel.reduce((n, m) => n + m.tokens, 0), 200);
    assert.equal(e.cacheReadTokens, 153); // 68 + 85
    assert.equal(e.cacheSavedPct, Math.round((153 / 200) * 100));
  });

  it("orders the feed most-recent-first, categorizes, and flags spawns", () => {
    const state = withCalls(emptySessionState("s1", "/p"), [
      { name: "Read", detail: "src/a.ts", timestamp: 1 },
      { name: "Bash", detail: "npm run test", timestamp: 2 },
      { name: "Agent", detail: "researcher", timestamp: 3 },
    ]);
    const vm = toSidebarViewModel([state]).sessions[0];

    assert.equal(vm.feed[0].name, "Agent");
    assert.equal(vm.feed[0].spawn, true);
    assert.equal(vm.feed[0].category, "flow");
    assert.equal(vm.feed[1].category, "bash");
    assert.equal(vm.feed[2].category, "read");
    assert.equal(vm.feed[2].spawn, false);
  });

  it("extracts touched files from file-tool calls, newest-access wins, dedup by path", () => {
    const state = withCalls(emptySessionState("s1", "/p"), [
      { name: "Read", detail: "src/a.ts", timestamp: 1 },
      { name: "Bash", detail: "grep foo", timestamp: 2 }, // not a file tool
      { name: "Edit", detail: "src/a.ts", timestamp: 3 }, // same path, later -> edit wins
      { name: "Write", detail: "docs/readme.md", timestamp: 4 },
    ]);
    const vm = toSidebarViewModel([state]).sessions[0];

    const byBase = Object.fromEntries(vm.files.map((f) => [f.base, f]));
    assert.equal(vm.files.length, 2);
    assert.equal(byBase["a.ts"].access, "edit");
    assert.equal(byBase["a.ts"].dir, "src");
    assert.equal(byBase["readme.md"].access, "edit");
    assert.equal(byBase["readme.md"].dir, "docs");
  });

  it("keeps file paths that contain spaces", () => {
    const state = withCalls(emptySessionState("s1", "/p"), [
      { name: "Edit", detail: "/Users/x/Application Support/app.ts", timestamp: 1 },
    ]);
    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.files.length, 1);
    assert.equal(vm.files[0].base, "app.ts");
    assert.equal(vm.files[0].dir, "/Users/x/Application Support");
  });

  it("passes the store-computed burn rate through to the view-model", () => {
    const state = { ...emptySessionState("s1", "/p"), burnRatePerMin: 42_000 };
    const vm = toSidebarViewModel([state]).sessions[0];
    assert.equal(vm.burnRatePerMin, 42_000);
  });

  it("sorts sessions by most-recently-updated", () => {
    const older = { ...emptySessionState("old", "/p"), lastUpdatedAt: 100 };
    const newer = { ...emptySessionState("new", "/p"), lastUpdatedAt: 200 };
    const vm = toSidebarViewModel([older, newer]);
    assert.equal(vm.sessions[0].sessionId, "new");
    assert.equal(vm.sessions[1].sessionId, "old");
  });

  it("passes the reducer-derived SessionStart source through, undefined when hooks are absent", () => {
    const withSource = { ...emptySessionState("s1", "/p"), lastSessionStartSource: "clear" };
    const withoutSource = emptySessionState("s2", "/p");
    const [vmWith, vmWithout] = toSidebarViewModel([withSource, withoutSource]).sessions;
    assert.equal(vmWith.sessionStartSource, "clear");
    assert.equal(vmWithout.sessionStartSource, undefined);
  });

  it("points a fresh /clear-ed session's clearedFrom at the most recent same-cwd predecessor", () => {
    const original = { ...emptySessionState("session-original1", "/p"), lastUpdatedAt: 100, title: "Fix login bug" };
    const cleared = {
      ...emptySessionState("session-clear0001", "/p"),
      lastUpdatedAt: 200,
      lastSessionStartSource: "clear",
    };
    const vm = toSidebarViewModel([original, cleared]);
    const clearedVm = vm.sessions.find((s) => s.sessionId === "session-clear0001");
    assert.equal(clearedVm?.clearedFrom, "Fix login bug");
  });

  it("falls back to the predecessor's shortId when it has no title", () => {
    const original = { ...emptySessionState("session-original2", "/p"), lastUpdatedAt: 100 };
    const cleared = {
      ...emptySessionState("session-clear0002", "/p"),
      lastUpdatedAt: 200,
      lastSessionStartSource: "clear",
    };
    const vm = toSidebarViewModel([original, cleared]);
    const clearedVm = vm.sessions.find((s) => s.sessionId === "session-clear0002");
    assert.equal(clearedVm?.clearedFrom, "session-");
  });

  it("leaves clearedFrom undefined once the cleared session has real activity", () => {
    const original = { ...emptySessionState("session-original3", "/p"), lastUpdatedAt: 100, title: "Fix login bug" };
    const cleared = {
      ...emptySessionState("session-clear0003", "/p"),
      lastUpdatedAt: 200,
      lastSessionStartSource: "clear",
      cumulativeUsage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
    const vm = toSidebarViewModel([original, cleared]);
    const clearedVm = vm.sessions.find((s) => s.sessionId === "session-clear0003");
    assert.equal(clearedVm?.clearedFrom, undefined);
  });

  it("leaves clearedFrom undefined when no other session shares the cwd", () => {
    const cleared = {
      ...emptySessionState("session-clear0004", "/other-cwd"),
      lastSessionStartSource: "clear",
    };
    const vm = toSidebarViewModel([cleared]).sessions[0];
    assert.equal(vm.clearedFrom, undefined);
  });
});
