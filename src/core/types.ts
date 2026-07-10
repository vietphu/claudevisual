export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cacheCreationInputTokens: a.cacheCreationInputTokens + (b.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: a.cacheReadInputTokens + (b.cacheReadInputTokens ?? 0),
  };
}

export type PermissionMode = "normal" | "acceptEdits" | "bypassPermissions" | "plan" | string;

export interface SessionState {
  sessionId: string;
  cwd: string;
  model: string | undefined;
  /** Sum of usage across every assistant turn this session — a total-spend proxy. */
  cumulativeUsage: TokenUsage;
  /**
   * `input + cache_read + cache_creation` tokens from the MOST RECENT assistant
   * turn only (excludes `output_tokens`, which is generated text, not context
   * occupancy). Approximates current context-window fill until Phase 4 wires
   * the precise `context_window.used_percentage` from statusLine. Must NOT be
   * a cumulative sum across turns — context is bounded by the model's window,
   * not by total session spend.
   */
  lastTurnContextTokens: number;
  permissionMode: PermissionMode | undefined;
  isLive: boolean;
  lastUpdatedAt: number;
  /** Sub-agents (`Task` tool invocations) seen this session, keyed by the tool_use id
   *  that also names their transcript file (`<sessionId>/subagents/agent-<id>.jsonl`). */
  subagents: Map<string, SubAgentState>;
  /** Distinct skill/command names invoked this session, in first-seen order. */
  skillsInvoked: string[];
  /** Bounded, most-recent-last ring buffer of tool_use calls (see `MAX_RECENT_TOOL_CALLS`). */
  recentToolCalls: ToolCallRecord[];
  /**
   * Low-latency overlay from the opt-in hooks event log (Phase 3,
   * `core/event-log-reader.ts`) — `true` while Claude is actively working
   * (prompt submitted / tool in flight), flipped ahead of the JSONL
   * transcript line landing. `false` once a `Stop`/idle hook event fires.
   * Stays `false` for the lifetime of the session if hooks were never
   * installed. Independent of `isLive` (process-alive) — a live process can
   * be idle awaiting the next user prompt.
   */
  running: boolean;
  /** Most recent `hook_event_name` seen for this session via the event log, if hooks are installed. */
  lastHookEvent: string | undefined;
  /** Timestamp (ms) `lastHookEvent` was recorded. */
  lastHookEventAt: number | undefined;
  /**
   * Precise context-window usage percentage (0-100) sourced from the
   * statusLine payload's `context_window.used_percentage` (Phase 4,
   * `core/event-log-reader.ts` tailing `statusline-cache.json`), present only
   * when the user has installed the statusline wrap. Takes priority over
   * `lastTurnContextTokens` for display — that field stays the JSONL-derived
   * approximation used as a fallback when the wrap isn't installed.
   */
  preciseContextPercent: number | undefined;
  /** Precise total session cost (USD) from the statusLine payload's `cost.total_cost_usd`. */
  preciseCostUsd: number | undefined;
  /** Timestamp (ms) `preciseContextPercent`/`preciseCostUsd` were last updated. */
  preciseStatusLineUpdatedAt: number | undefined;
}

export function emptySessionState(sessionId: string, cwd: string): SessionState {
  return {
    sessionId,
    cwd,
    model: undefined,
    cumulativeUsage: emptyUsage(),
    lastTurnContextTokens: 0,
    permissionMode: undefined,
    isLive: false,
    lastUpdatedAt: 0,
    subagents: new Map(),
    skillsInvoked: [],
    recentToolCalls: [],
    running: false,
    lastHookEvent: undefined,
    lastHookEventAt: undefined,
    preciseContextPercent: undefined,
    preciseCostUsd: undefined,
    preciseStatusLineUpdatedAt: undefined,
  };
}

export type SubAgentStatus = "running" | "completed";

/** Sentinel agentId for the main session's own activity, distinguishing it from
 *  spawned sub-agents in the shared agent-identity color map + economics rollup. */
export const MAIN_AGENT_ID = "main";

/** One `Task` tool invocation tracked for the lifetime of the parent session. */
export interface SubAgentState {
  agentId: string;
  subagentType: string;
  status: SubAgentStatus;
  tokens: TokenUsage;
  startedAt: number;
  lastUpdatedAt: number;
  /** The model this sub-agent runs on, captured from its transcript's
   *  `message.model` (a sub-agent's model is its own, independent of the
   *  parent's). Undefined until its first assistant line is reduced. */
  model?: string;
  /** Short human reason the agent was spawned — the `Task` tool call's
   *  `description` (falls back to a truncated `prompt`). Undefined if neither
   *  was present on the spawning call. */
  spawnReason?: string;
}

export function emptySubAgentState(
  agentId: string,
  subagentType: string,
  startedAt: number = Date.now()
): SubAgentState {
  return {
    agentId,
    subagentType,
    status: "running",
    tokens: emptyUsage(),
    startedAt,
    lastUpdatedAt: startedAt,
  };
}

/** One entry in the bounded `recentToolCalls` ring buffer surfaced in the tree view. */
export interface ToolCallRecord {
  name: string;
  detail?: string;
  timestamp: number;
}

/** Approximate context-window sizes (tokens) per model family, used only until
 * the precise statusLine-derived value is available (Phase 4). */
export const MODEL_CONTEXT_WINDOW_SIZE: Record<string, number> = {
  "claude-opus-4-8": 200_000,
  "claude-sonnet-5": 200_000,
  "claude-fable-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};

export const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;

export type ParsedLineType =
  | "user"
  | "assistant"
  | "mode"
  | "queue-operation"
  | "attachment"
  | "file-history-snapshot"
  | "last-prompt"
  | "ai-title"
  | "system"
  | (string & {});

/** Shape of `message.usage` as written by Claude Code (snake_case, API-native). */
export interface RawAssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ParsedLine {
  type: ParsedLineType;
  sessionId?: string;
  cwd?: string;
  raw: Record<string, unknown>;
}
