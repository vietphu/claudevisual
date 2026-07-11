import { addSkillInvocation } from "./skill-invocation-reducer";
import { extractToolUseBlocks, lineTimestamp, pushRecentToolCall } from "./tool-use-parsing";
import { AssistantMessage, ParsedLine, UserMessage } from "./transcript-types";
import { addUsage, SessionState } from "./types";

export { reduceSubAgentLine } from "./subagent-reducer";

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
}

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
  const withCwd = backfillCwd(state, line);
  switch (line.type) {
    case "assistant":
      return reduceAssistant(withCwd, line);
    case "user":
      return reduceUser(withCwd, line);
    case "mode":
      return reduceMode(withCwd, line);
    case "ai-title":
      return reduceAiTitle(withCwd, line);
    default:
      return withCwd;
  }
}

/**
 * Backfills `state.cwd` from any line that carries one, once — needed because
 * a tailer's first-ever touch of a session's transcript is a tail-window read
 * (never a from-byte-0 replay, see `jsonl-tailer.ts`), so the very first
 * complete line it parses can easily be one that omits `cwd`. Left at `""`,
 * `normalizeCwd("")` in `extension.ts` never matches a workspace folder, so
 * the sub-agent watcher for that session is silently never registered.
 */
function backfillCwd(state: SessionState, line: ParsedLine): SessionState {
  if (state.cwd !== "" || !line.cwd) {
    return state;
  }
  return { ...state, cwd: line.cwd };
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

  const { skillsInvoked, recentToolCalls } = reduceToolUseBlocks(state, message.content, lineTimestamp(line));

  return {
    ...state,
    model: message.model ?? state.model,
    cumulativeUsage: nextUsage,
    lastTurnContextTokens,
    skillsInvoked,
    recentToolCalls,
    lastUpdatedAt: Date.now(),
  };
}

/** Rough chars-per-token ratio for estimating tokens from raw text when no
 *  API usage figure is available yet (English/code-leaning transcripts). */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Marks a sub-agent as completed once its spawning `Agent` tool call's result
 * comes back on the parent transcript, per the standard Anthropic `tool_result`
 * content-block schema (`{ type: "tool_result", tool_use_id }`). Matched by
 * `toolUseId` (from the agent's own meta sidecar, see `applySubagentMetaOverlay`),
 * NOT by map key — the map is keyed by the transcript-filename agentId, which is
 * a different string from the spawning tool_use's id.
 *
 * Also detects `/compact`'s synthetic summary line (`isCompactSummary: true`,
 * plain-string `message.content`). `/compact` never calls the model, so there's
 * no fresh `usage` figure to react to — without this, %CONTEXT would keep
 * showing the pre-compaction snapshot until the next real assistant turn. We
 * estimate the new occupancy from the summary text length so the display drops
 * immediately; the next assistant turn's real `usage` overwrites this estimate.
 */
function reduceUser(state: SessionState, line: ParsedLine): SessionState {
  const message = line.raw.message as UserMessage | undefined;
  if (!message) {
    return state;
  }

  if (line.raw.isCompactSummary === true && typeof message.content === "string") {
    return {
      ...state,
      lastTurnContextTokens: Math.ceil(message.content.length / CHARS_PER_TOKEN_ESTIMATE),
      lastUpdatedAt: Date.now(),
    };
  }

  if (!Array.isArray(message.content)) {
    return state;
  }

  let subagents = state.subagents;
  let changed = false;
  for (const block of message.content as unknown[]) {
    const result = block as Partial<ToolResultBlock>;
    if (result?.type !== "tool_result" || typeof result.tool_use_id !== "string") {
      continue;
    }
    for (const [agentId, agent] of subagents) {
      if (agent.toolUseId !== result.tool_use_id || agent.status === "completed") {
        continue;
      }
      if (!changed) {
        subagents = new Map(subagents);
        changed = true;
      }
      subagents.set(agentId, { ...agent, status: "completed", lastUpdatedAt: Date.now() });
    }
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

/** Claude Code's own auto-generated session title, re-written periodically
 *  (see `SessionState.title`) — never bumps `lastUpdatedAt`, since this line
 *  carries no activity signal of its own. */
function reduceAiTitle(state: SessionState, line: ParsedLine): SessionState {
  const title = line.raw.aiTitle;
  if (typeof title !== "string" || title.length === 0) {
    return state;
  }
  return { ...state, title };
}

interface ToolUseReduction {
  skillsInvoked: SessionState["skillsInvoked"];
  recentToolCalls: SessionState["recentToolCalls"];
}

/** Scans one assistant turn's tool_use blocks for `Skill` invocations and every
 * call's entry in the recent-calls ring buffer. Sub-agent identity/nesting is
 * NOT derived here — see `applySubagentMetaOverlay` in `session-state-overlays.ts`. */
function reduceToolUseBlocks(state: SessionState, content: unknown, timestamp: number): ToolUseReduction {
  const toolUseBlocks = extractToolUseBlocks(content);
  let skillsInvoked = state.skillsInvoked;
  let recentToolCalls = state.recentToolCalls;

  for (const block of toolUseBlocks) {
    if (!block.name) {
      continue;
    }
    recentToolCalls = pushRecentToolCall(recentToolCalls, block, timestamp);
    if (block.name === "Skill") {
      skillsInvoked = addSkillInvocation(skillsInvoked, block.input);
    }
  }

  return { skillsInvoked, recentToolCalls };
}
