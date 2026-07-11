import { ParsedLine } from "./transcript-types";
import { ToolCallRecord } from "./types";

export interface ToolUseBlock {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Ring-buffer size for `recentToolCalls` — enough to populate a useful tree
 * node without holding an unbounded transcript history in memory. */
export const MAX_RECENT_TOOL_CALLS = 20;

/** Name of the sub-agent-spawning tool_use block, verified against real
 *  transcripts in `~/.claude/projects/**\/*.jsonl` (and their `subagents/`
 *  children) — every observed spawn across multiple real projects/sessions
 *  is named "Agent", never "Task". */
export const SPAWN_TOOL_NAME = "Agent";

export function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((block): block is ToolUseBlock => {
    return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_use";
  });
}

export function pushRecentToolCall(list: ToolCallRecord[], block: ToolUseBlock, timestamp: number): ToolCallRecord[] {
  const record: ToolCallRecord = {
    name: block.name as string,
    detail: extractToolCallDetail(block),
    timestamp,
  };
  const next = [...list, record];
  return next.length > MAX_RECENT_TOOL_CALLS ? next.slice(next.length - MAX_RECENT_TOOL_CALLS) : next;
}

/** Best-effort real event time for a transcript line — parses the line's
 *  `timestamp` (ISO 8601 string as written by Claude Code, or epoch ms),
 *  falling back to now when absent/unparseable so ordering still works. */
export function lineTimestamp(line: ParsedLine): number {
  const ts = line.raw.timestamp;
  if (typeof ts === "number" && ts > 0) {
    return ts;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function extractToolCallDetail(block: ToolUseBlock): string | undefined {
  const input = block.input;
  if (!input) {
    return undefined;
  }
  if (block.name === SPAWN_TOOL_NAME && typeof input.subagent_type === "string") {
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
