import { strict as assert } from "assert";
import {
  agentColorIndex,
  MAIN_AGENT_ID,
  MAIN_COLOR_INDEX,
  PALETTE_SIZE,
} from "../../src/ui/webview-view/agent-color";

describe("agent-color", () => {
  it("assigns the reserved index 0 to the main session", () => {
    assert.equal(agentColorIndex(MAIN_AGENT_ID), MAIN_COLOR_INDEX);
    assert.equal(MAIN_COLOR_INDEX, 0);
  });

  it("is deterministic for the same agentId", () => {
    const id = "agent-a93fac59c6bcb411a";
    assert.equal(agentColorIndex(id), agentColorIndex(id));
  });

  it("keeps non-main agents out of the reserved slot and within the palette", () => {
    for (const id of ["agent-1", "agent-2", "researcher", "tester", "planner", "x", "zzzzz"]) {
      const index = agentColorIndex(id);
      assert.ok(index >= 1, `${id} -> ${index} should be >= 1`);
      assert.ok(index < PALETTE_SIZE, `${id} -> ${index} should be < ${PALETTE_SIZE}`);
    }
  });

  it("spreads different agentIds across more than one slot", () => {
    const indices = new Set(
      Array.from({ length: 40 }, (_, i) => agentColorIndex(`agent-${i}`))
    );
    assert.ok(indices.size > 1, "expected more than one distinct color across 40 agents");
  });
});
