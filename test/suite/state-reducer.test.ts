import { strict as assert } from "assert";
import { reduceSessionState, reduceSubAgentLine } from "../../src/core/state-reducer";
import { emptySessionState, ParsedLine } from "../../src/core/types";

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

    it("should detect Task tool_use and create sub-agent state", () => {
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
                id: "agent-abc123",
                name: "Task",
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
      assert(result.subagents.has("agent-abc123"));
      const agent = result.subagents.get("agent-abc123");
      assert(agent !== undefined);
      assert.equal(agent.subagentType, "code-reviewer");
      assert.equal(agent.status, "running");
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

    it("should handle user line with tool_result blocks", () => {
      let state = emptySessionState("session-1", "/Users/test/project");

      // First add a Task to running state
      const taskLine: ParsedLine = {
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
                id: "agent-task-1",
                name: "Task",
                input: { subagent_type: "code-reviewer" },
              },
            ],
          },
        },
      };
      state = reduceSessionState(state, taskLine);
      assert.equal(state.subagents.get("agent-task-1")?.status, "running");

      // Now mark it as completed via tool_result
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
                tool_use_id: "agent-task-1",
              },
            ],
          },
        },
      };
      state = reduceSessionState(state, resultLine);
      assert.equal(state.subagents.get("agent-task-1")?.status, "completed");
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

  describe("sub-agent enrichment (model + spawn reason)", () => {
    function taskLine(input: Record<string, unknown>): ParsedLine {
      return {
        type: "assistant",
        sessionId: "s1",
        raw: {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "agent-e1", name: "Task", input }] },
        },
      };
    }

    it("captures the spawn reason from the Task description", () => {
      const state = reduceSessionState(
        emptySessionState("s1", "/p"),
        taskLine({ subagent_type: "researcher", description: "research auth", prompt: "long prompt body" })
      );
      assert.equal(state.subagents.get("agent-e1")?.spawnReason, "research auth");
    });

    it("falls back to a truncated prompt when no description", () => {
      const long = "x".repeat(120);
      const state = reduceSessionState(
        emptySessionState("s1", "/p"),
        taskLine({ subagent_type: "researcher", prompt: long })
      );
      const reason = state.subagents.get("agent-e1")?.spawnReason ?? "";
      assert.ok(reason.length <= 81 && reason.endsWith("…"));
    });

    it("captures the sub-agent's own model from its transcript line", () => {
      let state = reduceSessionState(
        emptySessionState("s1", "/p"),
        taskLine({ subagent_type: "researcher" })
      );
      const agentLine: ParsedLine = {
        type: "assistant",
        raw: { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 10 } } },
      };
      state = reduceSubAgentLine(state, "agent-e1", agentLine);
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
});
