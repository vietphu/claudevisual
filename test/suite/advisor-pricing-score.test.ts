import { strict as assert } from "assert";
import { estimateCostFromUsage, estimateCostFromState } from "../../src/core/model-pricing";
import { buildAdvisorContext } from "../../src/core/advisor/advisor-context";
import { efficiencyScore } from "../../src/core/advisor/efficiency-score";
import { emptySessionState, TokenUsage } from "../../src/core/types";

function usage(input: number, output: number, cacheCreate: number, cacheRead: number): TokenUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationInputTokens: cacheCreate, cacheReadInputTokens: cacheRead };
}

describe("split-rate pricing", () => {
  it("prices each bucket separately and sums to the total", () => {
    const b = estimateCostFromUsage([{ model: "claude-sonnet-5", usage: usage(1_000_000, 1_000_000, 1_000_000, 1_000_000) }]);
    assert.ok(b);
    // sonnet: 3 + 15 + 3.75 + 0.3 = 22.05
    assert.ok(Math.abs(b!.totalUsd - 22.05) < 1e-6);
    assert.ok(Math.abs(b!.inputUsd + b!.outputUsd + b!.cacheWriteUsd + b!.cacheReadUsd - b!.totalUsd) < 1e-9);
  });

  it("returns undefined when nothing can be priced", () => {
    assert.equal(estimateCostFromUsage([{ model: "unknown", usage: usage(10, 10, 10, 10) }]), undefined);
  });

  it("prices a whole session (main + sub-agents)", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-haiku-4-5";
    s.cumulativeUsage = usage(1_000_000, 0, 0, 0); // haiku input = $1
    const cost = estimateCostFromState(s);
    assert.ok(cost !== undefined && Math.abs(cost - 1.0) < 1e-6);
  });
});

describe("efficiency-score", () => {
  it("is neutral (grade A) for a just-started session", () => {
    const score = efficiencyScore(buildAdvisorContext(emptySessionState("s1", "/p")));
    assert.equal(score.neutral, true);
    assert.equal(score.grade, "A");
  });

  it("drops the grade when context is critical and cache churns", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.preciseContextPercent = 97;
    s.cumulativeUsage = usage(50_000, 5_000, 400_000, 20_000); // heavy churn
    const score = efficiencyScore(buildAdvisorContext(s));
    assert.equal(score.neutral, false);
    assert.ok(score.score < 60, `expected low score, got ${score.score}`);
    assert.equal(score.dimensions.length, 4);
  });

  it("stays bounded in [0,100]", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-opus-4-8";
    s.preciseContextPercent = 100;
    s.cumulativeUsage = usage(9_000_000, 100, 9_000_000, 0);
    const score = efficiencyScore(buildAdvisorContext(s));
    assert.ok(score.score >= 0 && score.score <= 100);
  });
});
