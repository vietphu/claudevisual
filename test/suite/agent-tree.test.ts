import { strict as assert } from "assert";
import { buildAgentTree, flattenAgentTree } from "../../src/core/agent-tree";
import { emptySubAgentState, SubAgentState } from "../../src/core/types";

function agent(id: string, startedAt: number, parentAgentId?: string): SubAgentState {
  return { ...emptySubAgentState(id, "researcher", startedAt), parentAgentId };
}

function mapOf(...agents: SubAgentState[]): Map<string, SubAgentState> {
  return new Map(agents.map((a) => [a.agentId, a]));
}

describe("agent-tree", () => {
  it("treats an agent with no parentAgentId as a root", () => {
    const tree = buildAgentTree(mapOf(agent("a", 1)));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].agent.agentId, "a");
    assert.equal(tree[0].depth, 0);
    assert.equal(tree[0].children.length, 0);
  });

  it("nests a child under the parent named by its own parentAgentId", () => {
    const tree = buildAgentTree(mapOf(agent("planner", 1), agent("r1", 2, "planner")));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].agent.agentId, "planner");
    assert.equal(tree[0].children.length, 1);
    assert.equal(tree[0].children[0].agent.agentId, "r1");
    assert.equal(tree[0].children[0].depth, 1);
  });

  it("orders roots and siblings by spawn time", () => {
    const tree = buildAgentTree(
      mapOf(agent("p", 1), agent("late", 30, "p"), agent("early", 10, "p"), agent("q", 2))
    );
    assert.deepEqual(
      tree.map((n) => n.agent.agentId),
      ["p", "q"]
    );
    assert.deepEqual(
      tree[0].children.map((n) => n.agent.agentId),
      ["early", "late"]
    );
  });

  it("renders an orphan at the root until its parent's own entry exists", () => {
    // Child's meta sidecar arrived (parentAgentId known), but the parent isn't
    // a known agent yet — stays a root (self-heals once the parent is seen).
    const before = buildAgentTree(mapOf(agent("r1", 2, "planner")));
    assert.deepEqual(
      before.map((n) => n.agent.agentId),
      ["r1"]
    );

    // Once the parent agent is known, the child nests.
    const after = buildAgentTree(mapOf(agent("planner", 1), agent("r1", 2, "planner")));
    assert.equal(after.length, 1);
    assert.equal(after[0].children[0].agent.agentId, "r1");
  });

  it("ignores a parentAgentId that isn't a known agent (no phantom nodes)", () => {
    const tree = buildAgentTree(mapOf(agent("orphan", 1, "ghost")));
    assert.equal(tree.length, 1);
    assert.equal(tree[0].agent.agentId, "orphan");
    assert.equal(tree[0].children.length, 0);
  });

  it("surfaces a pathological cycle's agents instead of dropping them (fail-open)", () => {
    const tree = buildAgentTree(mapOf(agent("a", 1, "b"), agent("b", 2, "a")));
    // 'a' claims 'b' as parent and 'b' claims 'a' → no root exists. The walk
    // must still terminate (visited guard) AND account for every agent.
    const flat = flattenAgentTree(tree).map((n) => n.agent.agentId);
    assert.equal(flat.length, 2);
    assert.ok(flat.includes("a") && flat.includes("b"));
  });

  it("flattens depth-first, parent before children", () => {
    const tree = buildAgentTree(
      mapOf(agent("p", 1), agent("c1", 2, "p"), agent("c2", 3, "p"), agent("g1", 4, "c1"))
    );
    assert.deepEqual(
      flattenAgentTree(tree).map((n) => `${n.agent.agentId}@${n.depth}`),
      ["p@0", "c1@1", "g1@2", "c2@1"]
    );
  });
});
