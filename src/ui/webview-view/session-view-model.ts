import { agentColorIndex } from "./agent-color";
import { resolveContextPercent, sumUsage } from "../../core/session-display";
import { estimateCostUsd } from "../../core/model-pricing";
import { tokenEconomics } from "../../core/token-economics";
import { MAIN_AGENT_ID, SessionState, SubAgentState, ToolCallRecord } from "../../core/types";
import { extractFiles } from "./touched-files";
import {
  AgentViewModel,
  EconomicsViewModel,
  FeedItemViewModel,
  SessionViewModel,
  SidebarViewModel,
  ToolCategory,
} from "./sidebar-messages";

/**
 * Pure host-side transform: `SessionState[]` (rich in-memory model, holds Maps)
 * → `SidebarViewModel` (flat serializable DTO the webview renders). vscode-free
 * and side-effect-free so it is unit-testable without the editor host.
 *
 * Phase 1/2 scope: vitals, a flat agent list, economics, the recent-activity
 * feed, and the files-touched panel — all from data already in `SessionState`.
 */
export function toSidebarViewModel(sessions: readonly SessionState[]): SidebarViewModel {
  const ordered = sessions.slice().sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  return { sessions: ordered.map(toSessionViewModel) };
}

function toSessionViewModel(state: SessionState): SessionViewModel {
  const { percent, precise } = resolveContextPercent(state);
  const calls = state.recentToolCalls.slice().reverse(); // most-recent first
  const economics = toEconomics(state);
  const { costUsd, costEstimated } = resolveCost(state, economics);
  return {
    sessionId: state.sessionId,
    shortId: state.sessionId.slice(0, 8),
    cwd: state.cwd,
    model: state.model,
    running: state.running,
    live: state.isLive,
    contextPercent: percent,
    contextPrecise: precise,
    totalTokens: sumUsage(state),
    costUsd,
    costEstimated,
    agents: Array.from(state.subagents.values())
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
      .map(toAgentViewModel),
    economics,
    heartbeat: buildHeartbeat(state),
    feed: calls.map(toFeedItem),
    files: extractFiles(calls),
  };
}

/** Max heartbeat bars kept — a recent window, not the whole session. */
const HEARTBEAT_MAX = 48;

/**
 * Activity heartbeat: merge the main session's tool calls (main identity color)
 * with every sub-agent's own tool calls (each agent's color), order by real
 * transcript time, and keep the most recent window. Purely derived from
 * `SessionState` — no hooks required.
 */
function buildHeartbeat(state: SessionState): number[] {
  const samples: Array<{ ts: number; colorIndex: number }> = [];
  const mainColor = agentColorIndex(MAIN_AGENT_ID);
  for (const call of state.recentToolCalls) {
    samples.push({ ts: call.timestamp, colorIndex: mainColor });
  }
  for (const agent of state.subagents.values()) {
    const color = agentColorIndex(agent.agentId);
    for (const call of agent.recentToolCalls) {
      samples.push({ ts: call.timestamp, colorIndex: color });
    }
  }
  samples.sort((a, b) => a.ts - b.ts);
  const tail = samples.length > HEARTBEAT_MAX ? samples.slice(samples.length - HEARTBEAT_MAX) : samples;
  return tail.map((s) => s.colorIndex);
}

/** Precise statusline cost wins; otherwise fall back to a pricing-table
 *  estimate off the per-model rollup (flagged `costEstimated`). */
function resolveCost(
  state: SessionState,
  economics: EconomicsViewModel
): { costUsd?: number; costEstimated: boolean } {
  if (state.preciseCostUsd !== undefined) {
    return { costUsd: state.preciseCostUsd, costEstimated: false };
  }
  return { costUsd: estimateCostUsd(economics.byModel), costEstimated: true };
}

function toEconomics(state: SessionState): EconomicsViewModel {
  const econ = tokenEconomics(state);
  return {
    totalTokens: econ.totalTokens,
    cacheReadTokens: econ.cacheReadTokens,
    cacheSavedPct: econ.cacheSavedPct,
    byAgent: econ.byAgent.map((a) => ({
      label: a.label,
      tokens: a.tokens,
      colorIndex: agentColorIndex(a.agentId),
    })),
    byModel: econ.byModel.map((m) => ({ model: m.model, tokens: m.tokens })),
  };
}

function toAgentViewModel(agent: SubAgentState): AgentViewModel {
  const t = agent.tokens;
  const calls = agent.recentToolCalls.slice().reverse(); // most-recent first
  return {
    agentId: agent.agentId,
    type: agent.subagentType,
    status: agent.status,
    tokens: t.inputTokens + t.outputTokens + t.cacheCreationInputTokens + t.cacheReadInputTokens,
    colorIndex: agentColorIndex(agent.agentId),
    model: agent.model,
    spawnReason: agent.spawnReason,
    detail: { calls: calls.map(toFeedItem), files: extractFiles(calls) },
  };
}

function toFeedItem(call: ToolCallRecord): FeedItemViewModel {
  return {
    name: call.name,
    detail: call.detail,
    category: categorize(call.name),
    time: formatClock(call.timestamp),
    spawn: call.name === "Task",
  };
}

function categorize(name: string): ToolCategory {
  if (name === "Read" || name === "Grep" || name === "Glob") {
    return "read";
  }
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
    return "edit";
  }
  if (name === "Bash") {
    return "bash";
  }
  if (name === "TodoWrite" || name === "Task") {
    return "flow";
  }
  if (name === "Skill") {
    return "agent";
  }
  return "other";
}

function formatClock(ms: number): string {
  if (!ms || ms <= 0) {
    return "";
  }
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
}
