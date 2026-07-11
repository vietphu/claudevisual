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

/** Shape of an assistant transcript line's `message` field — shared by the
 *  main-session and sub-agent reducers. */
export interface AssistantMessage {
  model?: string;
  usage?: RawAssistantUsage;
  content?: unknown;
  /** `"tool_use"` means this turn is requesting more tool calls (not done
   *  yet); any other non-null value (`"end_turn"`, `"max_tokens"`, ...) is a
   *  real, model-reported terminal signal for this turn. */
  stop_reason?: string | null;
}

/** Shape of a user transcript line's `message` field (carries `tool_result` blocks). */
export interface UserMessage {
  content?: unknown;
}
