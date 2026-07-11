import { strict as assert } from "assert";
import { reduceSessionState, reduceSubAgentLine } from "../../src/core/state-reducer";
import { emptySessionState, emptySubAgentState } from "../../src/core/types";
import { ParsedLine } from "../../src/core/transcript-types";

describe("state-reducer", () => {
  describe("reduceSessionState", () => {
    it("should handle assistant line with usage tokens", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            model: "claude-sonnet-5",
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 20,
            },
          },
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.cumulativeUsage.inputTokens, 100);
      assert.equal(result.cumulativeUsage.outputTokens, 50);
      assert.equal(result.cumulativeUsage.cacheCreationInputTokens, 10);
      assert.equal(result.cumulativeUsage.cacheReadInputTokens, 20);
      assert.equal(result.model, "claude-sonnet-5");
    });

    it("should accumulate usage across multiple assistant lines", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      const line1: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        },
      };

      state = reduceSessionState(state, line1);
      assert.equal(state.cumulativeUsage.inputTokens, 100);

      const line2: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 50,
              output_tokens: 25,
            },
          },
        },
      };

      state = reduceSessionState(state, line2);
      assert.equal(state.cumulativeUsage.inputTokens, 150);
      assert.equal(state.cumulativeUsage.outputTokens, 75);
    });

    it("should compute lastTurnContextTokens from latest turn only", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      const line1: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 10,
            },
          },
        },
      };

      state = reduceSessionState(state, line1);
      // lastTurnContextTokens = input + cache_read + cache_creation = 100 + 20 + 10 = 130
      assert.equal(state.lastTurnContextTokens, 130);

      const line2: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 200,
              output_tokens: 100,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 5,
            },
          },
        },
      };

      state = reduceSessionState(state, line2);
      // lastTurnContextTokens from latest turn only = 200 + 30 + 5 = 235
      assert.equal(state.lastTurnContextTokens, 235);
    });

    it("estimates context occupancy from a /compact summary line immediately, without waiting for a new assistant turn", () => {
      // Real case: `/compact` never calls the model, so the transcript's next
      // line is a plain-string `user` message flagged `isCompactSummary: true`
      // with no `usage` field — nothing for the normal assistant-turn path to
      // react to. Without this, %CONTEXT keeps showing the stale pre-compact
      // snapshot until the user's next prompt produces a real assistant turn.
      let state = emptySessionState("session-1", "/Users/test/project");
      state = { ...state, lastTurnContextTokens: 850_000 }; // stale pre-compact snapshot

      const summaryText = "x".repeat(4000); // ~1000 tokens at 4 chars/token
      const line: ParsedLine = {
        type: "user",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "user",
          isCompactSummary: true,
          message: { content: summaryText },
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.lastTurnContextTokens, 1000);
    });

    it("leaves lastTurnContextTokens untouched for a normal user line (no isCompactSummary flag)", () => {
      let state = emptySessionState("session-1", "/Users/test/project");
      state = { ...state, lastTurnContextTokens: 42_000 };

      const line: ParsedLine = {
        type: "user",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "user",
          message: { content: "just a regular follow-up prompt" },
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.lastTurnContextTokens, 42_000);
    });

    it("should handle mode line and update permissionMode", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "mode",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "mode",
          mode: "acceptEdits",
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.permissionMode, "acceptEdits");
    });

    it("should handle ai-title line and set title", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "ai-title",
        sessionId: "session-1",
        raw: {
          type: "ai-title",
          sessionId: "session-1",
          aiTitle: "Fix flaky login test",
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.title, "Fix flaky login test");
    });

    it("overwrites an earlier title with a later ai-title line (re-titled as the conversation evolves)", () => {
      let state = emptySessionState("session-1", "/Users/test/project");
      state = reduceSessionState(state, {
        type: "ai-title",
        raw: { type: "ai-title", aiTitle: "Investigate login bug" },
      });
      assert.equal(state.title, "Investigate login bug");

      state = reduceSessionState(state, {
        type: "ai-title",
        raw: { type: "ai-title", aiTitle: "Fix flaky login test" },
      });
      assert.equal(state.title, "Fix flaky login test");
    });

    it("ignores an ai-title line with a missing or empty aiTitle", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const result = reduceSessionState(state, {
        type: "ai-title",
        raw: { type: "ai-title", aiTitle: "" },
      });
      assert.equal(result.title, undefined);
    });

    it("does not create a sub-agent entry from an Agent tool_use block alone", () => {
      // Identity (type, spawn reason, parent) comes only from the agent's own
      // `.meta.json` sidecar — see `applySubagentMetaOverlay` — never from the
      // spawning call's tool_use id, which is a distinct string from the
      // sub-agent's real agentId in real transcripts.
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
            content: [
              {
                type: "tool_use",
                id: "toolu_abc123",
                name: "Agent",
                input: {
                  subagent_type: "code-reviewer",
                  prompt: "Review this code",
                },
              },
            ],
          },
        },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.subagents.size, 0);
      assert.equal(result.recentToolCalls[0].name, "Agent");
    });

    it("should detect Skill tool_use and record in skillsInvoked", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [
              {
                type: "tool_use",
                id: "skill-123",
                name: "Skill",
                input: {
                  command: "test",
                },
              },
            ],
          },
        },
      };

      const result = reduceSessionState(state, line);
      assert(result.skillsInvoked.includes("test"));
    });

    it("should not duplicate skill invocations", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      for (let i = 0; i < 3; i++) {
        const line: ParsedLine = {
          type: "assistant",
          sessionId: "session-1",
          cwd: "/Users/test/project",
          raw: {
            type: "assistant",
            message: {
              usage: { input_tokens: 10, output_tokens: 5 },
              content: [
                {
                  type: "tool_use",
                  id: `skill-${i}`,
                  name: "Skill",
                  input: { command: "test" },
                },
              ],
            },
          },
        };
        state = reduceSessionState(state, line);
      }

      assert.equal(state.skillsInvoked.length, 1);
      assert.equal(state.skillsInvoked[0], "test");
    });

    it("should ignore unknown line types without throwing", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "unknown-future-type",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "unknown-future-type",
          someData: "value",
        },
      };

      const result = reduceSessionState(state, line);
      assert.deepEqual(result, state, "Unknown types should be no-ops");
    });

    it("backfills cwd from a later line once, when the session was created without one", () => {
      const state = emptySessionState("session-1", "");
      const line: ParsedLine = {
        type: "unknown-future-type",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: { type: "unknown-future-type" },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.cwd, "/Users/test/project");
    });

    it("never overwrites an already-known cwd with a later line's value", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "unknown-future-type",
        sessionId: "session-1",
        cwd: "/Users/test/other-project",
        raw: { type: "unknown-future-type" },
      };

      const result = reduceSessionState(state, line);
      assert.equal(result.cwd, "/Users/test/project");
    });

    it("should handle assistant line without message field", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
        },
      };

      const result = reduceSessionState(state, line);
      assert.deepEqual(result, state, "Assistant without message should be no-op");
    });

    it("should handle user line with tool_result blocks, matched by the agent's toolUseId (not its map key)", () => {
      let state = emptySessionState("session-1", "/Users/test/project");
      // The map key is the transcript-filename agentId; `toolUseId` (from the
      // agent's meta sidecar) is the spawning call's id, a different string.
      const agent = { ...emptySubAgentState("real-agent-id", "code-reviewer", 1), toolUseId: "toolu_abc123" };
      state = { ...state, subagents: new Map([["real-agent-id", agent]]) };
      assert.equal(state.subagents.get("real-agent-id")?.status, "running");

      const resultLine: ParsedLine = {
        type: "user",
        sessionId: "session-1",
        cwd: "/Users/test/project",
        raw: {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_abc123",
              },
            ],
          },
        },
      };
      state = reduceSessionState(state, resultLine);
      assert.equal(state.subagents.get("real-agent-id")?.status, "completed");
    });

    it("should maintain recentToolCalls ring buffer (max 20)", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      // Add 25 tool calls
      for (let i = 0; i < 25; i++) {
        const line: ParsedLine = {
          type: "assistant",
          sessionId: "session-1",
          cwd: "/Users/test/project",
          raw: {
            type: "assistant",
            message: {
              usage: { input_tokens: 10, output_tokens: 5 },
              content: [
                {
                  type: "tool_use",
                  id: `tool-${i}`,
                  name: "Bash",
                  input: { command: `echo ${i}` },
                },
              ],
            },
          },
        };
        state = reduceSessionState(state, line);
      }

      // Should only have the last 20
      assert.equal(state.recentToolCalls.length, 20);
      assert.equal(state.recentToolCalls[0].detail, "echo 5");
      assert.equal(state.recentToolCalls[19].detail, "echo 24");
    });
  });

  describe("reduceSubAgentLine", () => {
    it("should accumulate sub-agent token usage from assistant line", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 20,
            },
          },
        },
      };

      const result = reduceSubAgentLine(state, "agent-abc123", line);
      assert(result.subagents.has("agent-abc123"));
      const agent = result.subagents.get("agent-abc123");
      assert(agent !== undefined);
      assert.equal(agent.tokens.inputTokens, 100);
      assert.equal(agent.tokens.outputTokens, 50);
    });

    it("should accumulate tokens across multiple sub-agent assistant lines", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      const line1: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        },
      };
      state = reduceSubAgentLine(state, "agent-123", line1);

      const line2: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            usage: {
              input_tokens: 50,
              output_tokens: 25,
            },
          },
        },
      };
      state = reduceSubAgentLine(state, "agent-123", line2);

      const agent = state.subagents.get("agent-123");
      assert(agent !== undefined);
      assert.equal(agent.tokens.inputTokens, 150);
      assert.equal(agent.tokens.outputTokens, 75);
    });

    it("marks a sub-agent completed from its own stop_reason, independent of any parent tool_result", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: { type: "assistant", message: { usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" } },
      };

      const result = reduceSubAgentLine(state, "agent-e2", line);
      assert.equal(result.subagents.get("agent-e2")?.status, "completed");
    });

    it("leaves status running while stop_reason is tool_use (more calls coming)", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: { type: "assistant", message: { usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" } },
      };

      const result = reduceSubAgentLine(state, "agent-t2", line);
      assert.equal(result.subagents.get("agent-t2")?.status, "running");
    });

    it("never flips a completed sub-agent back to running from a later line", () => {
      let state = emptySessionState("session-1", "/Users/test/project");
      const doneLine: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: { type: "assistant", message: { stop_reason: "end_turn" } },
      };
      state = reduceSubAgentLine(state, "agent-e3", doneLine);
      assert.equal(state.subagents.get("agent-e3")?.status, "completed");

      const laterLine: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: { type: "assistant", message: { stop_reason: null } },
      };
      state = reduceSubAgentLine(state, "agent-e3", laterLine);
      assert.equal(state.subagents.get("agent-e3")?.status, "completed");
    });

    it("should ignore non-assistant lines", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "user",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "user",
          message: {
            content: [],
          },
        },
      };

      const result = reduceSubAgentLine(state, "agent-123", line);
      assert.deepEqual(result, state, "Non-assistant lines should be no-ops");
    });

    it("should handle assistant line without message field", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
        },
      };

      const result = reduceSubAgentLine(state, "agent-123", line);
      assert.deepEqual(result, state, "Assistant without message should be no-op");
    });

    it("should handle assistant line with missing usage", () => {
      const state = emptySessionState("session-1", "/Users/test/project");
      const line: ParsedLine = {
        type: "assistant",
        sessionId: "agent-123",
        cwd: "/Users/test/project",
        raw: {
          type: "assistant",
          message: {
            content: [],
          },
        },
      };

      const result = reduceSubAgentLine(state, "agent-123", line);
      assert(result.subagents.has("agent-123"));
      const agent = result.subagents.get("agent-123");
      assert(agent !== undefined);
      assert.equal(agent.tokens.inputTokens, 0);
    });
  });

  // Spawn-reason/type/parent enrichment moved to `applySubagentMetaOverlay`
  // (see session-state-overlays.test.ts) — it's sourced from the agent's own
  // `.meta.json` sidecar now, not from scanning transcript content for nested
  // `Agent` tool_use blocks.
  describe("sub-agent model capture", () => {
    it("captures the sub-agent's own model from its transcript line", () => {
      const agentLine: ParsedLine = {
        type: "assistant",
        raw: { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 10 } } },
      };
      const state = reduceSubAgentLine(emptySessionState("s1", "/p"), "agent-e1", agentLine);
      assert.equal(state.subagents.get("agent-e1")?.model, "claude-sonnet-5");
    });

    it("never lets a sub-agent line mutate the parent's cumulative usage", () => {
      const parent = { ...emptySessionState("s1", "/p") };
      parent.cumulativeUsage = {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      };
      const agentLine: ParsedLine = {
        type: "assistant",
        raw: { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 999 } } },
      };
      const after = reduceSubAgentLine(parent, "agent-e1", agentLine);
      assert.deepEqual(after.cumulativeUsage, parent.cumulativeUsage);
    });
  });

  describe("tool-call timeline (real transcript timestamps)", () => {
    it("parses a sub-agent's tool_use blocks into its ring with the line's real ISO time", () => {
      const iso = "2026-07-10T09:24:20.201Z";
      const agentLine: ParsedLine = {
        type: "assistant",
        raw: {
          type: "assistant",
          timestamp: iso,
          message: { content: [{ type: "tool_use", id: "x", name: "Read", input: { file_path: "src/a.ts" } }] },
        },
      };
      const state = reduceSubAgentLine(emptySessionState("s1", "/p"), "agent-t1", agentLine);
      const agent = state.subagents.get("agent-t1");
      assert.equal(agent?.recentToolCalls.length, 1);
      assert.equal(agent?.recentToolCalls[0].name, "Read");
      assert.equal(agent?.recentToolCalls[0].detail, "src/a.ts");
      assert.equal(agent?.recentToolCalls[0].timestamp, Date.parse(iso));
    });

    it("stamps main-session tool calls with the line's real transcript time", () => {
      const iso = "2026-07-10T10:00:00.000Z";
      const state = reduceSessionState(emptySessionState("s1", "/p"), {
        type: "assistant",
        sessionId: "s1",
        raw: {
          type: "assistant",
          timestamp: iso,
          message: { content: [{ type: "tool_use", id: "y", name: "Bash", input: { command: "ls" } }] },
        },
      });
      assert.equal(state.recentToolCalls[0].timestamp, Date.parse(iso));
    });
  });
});
