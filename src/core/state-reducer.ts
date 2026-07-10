import {
  addUsage,
  emptySubAgentState,
  ParsedLine,
  RawAssistantUsage,
  SessionState,
  SubAgentState,
  ToolCallRecord,
} from "./types";

interface AssistantMessage {
  model?: string;
  usage?: RawAssistantUsage;
  content?: unknown;
}

interface UserMessage {
  content?: unknown;
}

interface ToolUseBlock {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
}

/** Ring-buffer size for `recentToolCalls` — enough to populate a useful tree
 * node without holding an unbounded transcript history in memory. */
const MAX_RECENT_TOOL_CALLS = 20;

/**
 * Pure reducer: (previous state, next parsed line) -> next state. Unknown
 * line types are no-ops so schema drift in the transcript format never
 * throws — it just doesn't update state.
 *
 * IMPORTANT: `message.usage` at the top level is used directly as the
 * session's cumulative usage; it must NOT be summed with
 * `message.usage.iterations[]`. Verified empirically across several real
 * transcripts: top-level usage already equals the sum of iterations whose
 * `type === "message"`. Iterations with `type === "advisor_message"` are a
 * separate internal call (different model) not included in the top-level
 * total — summing all iterations would double-count real usage.
 */
export function reduceSessionState(state: SessionState, line: ParsedLine): SessionState {
  switch (line.type) {
    case "assistant":
      return reduceAssistant(state, line);
    case "user":
      return reduceUser(state, line);
    case "mode":
      return reduceMode(state, line);
    default:
      return state;
  }
}

/**
 * Reduces one line read from a sub-agent's own transcript
 * (`<sessionId>/subagents/agent-<agentId>.jsonl`) into the parent session's
 * `subagents` map, keyed by `agentId`. Kept separate from
 * `reduceSessionState` because these lines must never feed the parent
 * session's own `cumulativeUsage` / `model` / `lastTurnContextTokens` — a
 * sub-agent's token spend and model are its own, not the parent turn's.
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
  const updated: SubAgentState = { ...existing, tokens: nextTokens, model, lastUpdatedAt: Date.now() };
  const subagents = new Map(state.subagents);
  subagents.set(agentId, updated);
  return { ...state, subagents, lastUpdatedAt: Date.now() };
}

function reduceAssistant(state: SessionState, line: ParsedLine): SessionState {
  const message = line.raw.message as AssistantMessage | undefined;
  if (!message) {
    return state;
  }

  const usage = message.usage;
  const nextUsage = usage
    ? addUsage(state.cumulativeUsage, {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      })
    : state.cumulativeUsage;

  // Context occupancy is a snapshot of the latest turn, not a running total.
  const lastTurnContextTokens = usage
    ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    : state.lastTurnContextTokens;

  const { subagents, skillsInvoked, recentToolCalls } = reduceToolUseBlocks(state, message.content);

  return {
    ...state,
    model: message.model ?? state.model,
    cumulativeUsage: nextUsage,
    lastTurnContextTokens,
    subagents,
    skillsInvoked,
    recentToolCalls,
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Marks a sub-agent as completed once its `Task` tool call's result comes
 * back on the parent transcript, per the standard Anthropic `tool_result`
 * content-block schema (`{ type: "tool_result", tool_use_id }`).
 */
function reduceUser(state: SessionState, line: ParsedLine): SessionState {
  const message = line.raw.message as UserMessage | undefined;
  if (!message || !Array.isArray(message.content)) {
    return state;
  }

  let subagents = state.subagents;
  let changed = false;
  for (const block of message.content as unknown[]) {
    const result = block as Partial<ToolResultBlock>;
    if (result?.type !== "tool_result" || typeof result.tool_use_id !== "string") {
      continue;
    }
    const existing = subagents.get(result.tool_use_id);
    if (!existing || existing.status === "completed") {
      continue;
    }
    if (!changed) {
      subagents = new Map(subagents);
      changed = true;
    }
    subagents.set(result.tool_use_id, { ...existing, status: "completed", lastUpdatedAt: Date.now() });
  }

  return changed ? { ...state, subagents, lastUpdatedAt: Date.now() } : state;
}

function reduceMode(state: SessionState, line: ParsedLine): SessionState {
  const mode = line.raw.mode;
  if (typeof mode !== "string") {
    return state;
  }
  return { ...state, permissionMode: mode, lastUpdatedAt: Date.now() };
}

interface ToolUseReduction {
  subagents: SessionState["subagents"];
  skillsInvoked: SessionState["skillsInvoked"];
  recentToolCalls: SessionState["recentToolCalls"];
}

/** Scans one assistant turn's tool_use blocks for `Task` (sub-agents), `Skill`
 * (skill invocations), and every call's entry in the recent-calls ring buffer. */
function reduceToolUseBlocks(state: SessionState, content: unknown): ToolUseReduction {
  const toolUseBlocks = extractToolUseBlocks(content);
  let subagents = state.subagents;
  let skillsInvoked = state.skillsInvoked;
  let recentToolCalls = state.recentToolCalls;

  for (const block of toolUseBlocks) {
    if (!block.name) {
      continue;
    }
    recentToolCalls = pushRecentToolCall(recentToolCalls, block);
    if (block.name === "Task" && block.id) {
      subagents = upsertSubAgentFromTask(subagents, block.id, block.input);
    } else if (block.name === "Skill") {
      skillsInvoked = addSkillInvocation(skillsInvoked, block.input);
    }
  }

  return { subagents, skillsInvoked, recentToolCalls };
}

function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((block): block is ToolUseBlock => {
    return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use";
  });
}

function upsertSubAgentFromTask(
  subagents: Map<string, SubAgentState>,
  agentId: string,
  input: Record<string, unknown> | undefined
): Map<string, SubAgentState> {
  if (subagents.has(agentId)) {
    return subagents;
  }
  const subagentType = typeof input?.subagent_type === "string" ? input.subagent_type : "unknown";
  const next = new Map(subagents);
  next.set(agentId, { ...emptySubAgentState(agentId, subagentType), spawnReason: extractSpawnReason(input) });
  return next;
}

/** Pulls a short spawn reason off a `Task` call's input — the `description`
 *  field if present, else a truncated `prompt`. Undefined when neither exists. */
function extractSpawnReason(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  if (typeof input.description === "string" && input.description.trim().length > 0) {
    return input.description.trim();
  }
  if (typeof input.prompt === "string" && input.prompt.trim().length > 0) {
    const prompt = input.prompt.trim();
    return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
  }
  return undefined;
}

function addSkillInvocation(skillsInvoked: string[], input: Record<string, unknown> | undefined): string[] {
  const name = extractSkillName(input);
  if (!name || skillsInvoked.includes(name)) {
    return skillsInvoked;
  }
  return [...skillsInvoked, name];
}

function extractSkillName(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  for (const key of ["command", "skill", "name"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function pushRecentToolCall(list: ToolCallRecord[], block: ToolUseBlock): ToolCallRecord[] {
  const record: ToolCallRecord = {
    name: block.name as string,
    detail: extractToolCallDetail(block),
    timestamp: Date.now(),
  };
  const next = [...list, record];
  return next.length > MAX_RECENT_TOOL_CALLS ? next.slice(next.length - MAX_RECENT_TOOL_CALLS) : next;
}

function extractToolCallDetail(block: ToolUseBlock): string | undefined {
  const input = block.input;
  if (!input) {
    return undefined;
  }
  if (block.name === "Task" && typeof input.subagent_type === "string") {
    return input.subagent_type;
  }
  for (const key of ["command", "file_path", "pattern", "description", "skill"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
