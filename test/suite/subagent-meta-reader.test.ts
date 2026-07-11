import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readSubagentMeta } from "../../src/core/subagent-meta-reader";

describe("subagent-meta-reader", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudevisual-meta-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a well-formed sidecar", () => {
    fs.writeFileSync(
      path.join(dir, "agent-a1.meta.json"),
      JSON.stringify({
        agentType: "Explore",
        description: "map the auth flow",
        toolUseId: "toolu_abc123",
        parentAgentId: "parent-1",
        spawnDepth: 2,
      })
    );
    const meta = readSubagentMeta(dir, "a1");
    assert.equal(meta?.agentType, "Explore");
    assert.equal(meta?.description, "map the auth flow");
    assert.equal(meta?.toolUseId, "toolu_abc123");
    assert.equal(meta?.parentAgentId, "parent-1");
  });

  it("returns undefined for a missing file (fail-open)", () => {
    assert.equal(readSubagentMeta(dir, "does-not-exist"), undefined);
  });

  it("returns undefined for malformed JSON (fail-open)", () => {
    fs.writeFileSync(path.join(dir, "agent-a2.meta.json"), "{not valid json");
    assert.equal(readSubagentMeta(dir, "a2"), undefined);
  });

  it("ignores non-string fields rather than throwing", () => {
    fs.writeFileSync(path.join(dir, "agent-a3.meta.json"), JSON.stringify({ agentType: 42, description: null }));
    const meta = readSubagentMeta(dir, "a3");
    assert.equal(meta?.agentType, undefined);
    assert.equal(meta?.description, undefined);
  });

  it("has no parentAgentId for a top-level agent", () => {
    fs.writeFileSync(
      path.join(dir, "agent-a4.meta.json"),
      JSON.stringify({ agentType: "planner", description: "plan the feature" })
    );
    assert.equal(readSubagentMeta(dir, "a4")?.parentAgentId, undefined);
  });
});
