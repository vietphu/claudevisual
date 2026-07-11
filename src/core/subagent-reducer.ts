import { extractToolUseBlocks, lineTimestamp, pushRecentToolCall } from "./tool-use-parsing";
import { AssistantMessage, ParsedLine } from "./transcript-types";
import { addUsage, emptySubAgentState, SessionState, SubAgentState } from "./types";

/**
 * Reduces one line read from a sub-agent's own transcript
 * (`<sessionId>/subagents/agent-<agentId>.jsonl`) into the parent session's
 * `subagents` map, keyed by `agentId`. Kept separate from
 * `reduceSessionState` because these lines must never feed the parent
 * session's own `cumulativeUsage` / `model` / `lastTurnContextTokens` — a
 * sub-agent's token spend and model are its own, not the parent turn's.
 *
 * Identity (type, spawn reason, parent) is NOT derived from this agent's own
 * `Agent` tool_use blocks (nested spawns) — see `applySubagentMetaOverlay` in
 * `session-state-overlays.ts`, which reads each child's own meta sidecar.
 */
export function reduceSubAgentLine(state: SessionState, agentId: string, line: ParsedLine): SessionState {
  if (line.type !== "assistant") {
    return state;
  }
  const message = line.raw.message as AssistantMessage | undefined;
  if (!message) {
    return state;
  }

  const existing = state.subagents.get(agentId) ?? emptySubAgentState(agentId, "unknown");
  const usage = message.usage;
  const nextTokens = usage
    ? addUsage(existing.tokens, {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      })
    : existing.tokens;

  // First non-empty model wins — a sub-agent's model is stable for its lifetime.
  const model = existing.model ?? (typeof message.model === "string" ? message.model : undefined);
  // Parse this sub-agent's own tool_use blocks into its ring buffer, stamped
  // with the line's real transcript time (drives drill-down + heartbeat).
  const ts = lineTimestamp(line);
  let recentToolCalls = existing.recentToolCalls;
  for (const block of extractToolUseBlocks(message.content)) {
    if (!block.name) {
      continue;
    }
    recentToolCalls = pushRecentToolCall(recentToolCalls, block, ts);
  }
  const updated: SubAgentState = {
    ...existing,
    tokens: nextTokens,
    model,
    recentToolCalls,
    lastUpdatedAt: Date.now(),
  };
  const subagents = new Map(state.subagents);
  subagents.set(agentId, updated);
  return { ...state, subagents, lastUpdatedAt: Date.now() };
}
