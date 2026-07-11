import * as fs from "fs";
import * as path from "path";

/**
 * Contents of a sub-agent's `agent-<agentId>.meta.json` sidecar — written once
 * at spawn time (unlike the appended `.jsonl` transcript), verified empirically
 * across multiple real projects as the authoritative source for a sub-agent's
 * type, spawn reason, and parent. NOT derivable from the parent's `Agent`
 * tool_use `id`: that id is a `toolu_...` string distinct from this file's
 * `agentId`, so without this sidecar there is no way to correlate the two.
 */
export interface SubagentMeta {
  agentType?: string;
  description?: string;
  parentAgentId?: string;
  /** The `id` of the `Agent` tool_use block that spawned this agent — the only
   *  way to correlate a `tool_result` back to this agent's transcript-derived
   *  entry, since that id is unrelated to this file's `agentId`. */
  toolUseId?: string;
}

/** Reads and tolerantly parses one sub-agent's meta sidecar. Returns undefined
 *  for a missing or malformed file (fail-open) — the caller retries on the
 *  next transcript-file event rather than treating this as a hard error. */
export function readSubagentMeta(subagentsDir: string, agentId: string): SubagentMeta | undefined {
  const metaPath = path.join(subagentsDir, `agent-${agentId}.meta.json`);
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      agentType: typeof parsed.agentType === "string" ? parsed.agentType : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      parentAgentId: typeof parsed.parentAgentId === "string" ? parsed.parentAgentId : undefined,
      toolUseId: typeof parsed.toolUseId === "string" ? parsed.toolUseId : undefined,
    };
  } catch {
    return undefined;
  }
}
