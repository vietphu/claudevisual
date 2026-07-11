import { deriveRunningState, HookEventRecord, StatuslineCacheRecord } from "./hook-event-parsing";
import { SubagentMeta } from "./subagent-meta-reader";
import { emptySessionState, emptySubAgentState, SessionState, SubAgentState } from "./types";

/**
 * Pure overlay transforms `SessionStateStore` applies on top of the
 * JSONL-derived state — hook events (low-latency `running` bit) and statusline
 * snapshots (precise context%/cost). Race-tolerant: when `previous` is
 * undefined (the event won the race against the transcript line establishing
 * the session), a minimal placeholder is synthesized so the signal isn't
 * dropped — the JSONL tailer fills in the rest once its line arrives.
 */

export function applyHookEventOverlay(previous: SessionState | undefined, record: HookEventRecord): SessionState {
  const nextRunning = deriveRunningState(record.hookEvent) ?? previous?.running ?? false;
  const base = previous ?? emptySessionState(record.sessionId, "");
  return {
    ...base,
    running: nextRunning,
    lastHookEvent: record.hookEvent ?? base.lastHookEvent,
    lastHookEventAt: record.ts,
    lastUpdatedAt: Math.max(base.lastUpdatedAt, record.ts),
  };
}

export function applyStatuslineOverlay(
  previous: SessionState | undefined,
  record: StatuslineCacheRecord
): SessionState {
  const base = previous ?? emptySessionState(record.sessionId, "");
  return {
    ...base,
    preciseContextPercent: record.contextUsedPercent ?? base.preciseContextPercent,
    preciseContextWindowSize: record.contextWindowSize ?? base.preciseContextWindowSize,
    preciseCostUsd: record.costUsd ?? base.preciseCostUsd,
    preciseStatusLineUpdatedAt: record.ts,
    lastUpdatedAt: Math.max(base.lastUpdatedAt, record.ts),
  };
}

/**
 * Overlays a sub-agent's `.meta.json` sidecar (see `core/subagent-meta-reader.ts`)
 * onto its entry in `subagents` — the authoritative source for its type, spawn
 * reason, and parent (nesting; see `core/agent-tree.ts`). Same race-tolerant
 * placeholder synthesis as the overlays above: the sidecar can be read before
 * the parent session or the sub-agent's own transcript line is known.
 */
export function applySubagentMetaOverlay(
  previous: SessionState | undefined,
  sessionId: string,
  agentId: string,
  meta: SubagentMeta
): SessionState {
  const base = previous ?? emptySessionState(sessionId, "");
  const existing = base.subagents.get(agentId) ?? emptySubAgentState(agentId, "unknown");
  const updated: SubAgentState = {
    ...existing,
    subagentType: meta.agentType ?? existing.subagentType,
    spawnReason: meta.description ?? existing.spawnReason,
    parentAgentId: meta.parentAgentId ?? existing.parentAgentId,
    toolUseId: meta.toolUseId ?? existing.toolUseId,
  };
  const subagents = new Map(base.subagents);
  subagents.set(agentId, updated);
  return { ...base, subagents, lastUpdatedAt: Date.now() };
}
