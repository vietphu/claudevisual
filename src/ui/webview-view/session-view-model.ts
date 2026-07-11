import { agentColorIndex } from "./agent-color";
import { buildAgentTree, flattenAgentTree } from "../../core/agent-tree";
import { toFeedItem } from "./feed-item";
import { buildHeartbeat } from "./heartbeat";
import { resolveContextPercent, sumUsage } from "../../core/session-display";
import { estimateCostUsd } from "../../core/model-pricing";
import { tokenEconomics } from "../../core/token-economics";
import { MAIN_AGENT_ID, SessionState, SubAgentState, ToolCallRecord } from "../../core/types";
import { extractFiles } from "./touched-files";
import { AgentViewModel, EconomicsViewModel, SessionViewModel, SidebarViewModel } from "./sidebar-messages";

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
  const { percent, precise, usedTokens, windowTokens } = resolveContextPercent(state);
  const calls = state.recentToolCalls.slice().reverse(); // most-recent first
  const economics = toEconomics(state);
  const { costUsd, costEstimated } = resolveCost(state, economics);
  return {
    sessionId: state.sessionId,
    shortId: state.sessionId.slice(0, 8),
    cwd: state.cwd,
    title: state.title,
    model: state.model,
    running: state.running,
    live: state.isLive,
    contextPercent: percent,
    contextPrecise: precise,
    contextUsedTokens: usedTokens,
    contextWindowTokens: windowTokens,
    totalTokens: sumUsage(state),
    costUsd,
    costEstimated,
    burnRatePerMin: state.burnRatePerMin,
    // Orchestration tree: the main session is the synthetic root, with its
    // spawned sub-agents nested beneath (pre-order — a parent row immediately
    // precedes its nested children, each tagged with its depth for indentation).
    // Main is only shown once orchestration actually happened (≥1 sub-agent).
    mainAgent: state.subagents.size > 0 ? toMainAgentViewModel(state) : undefined,
    agents: flattenAgentTree(buildAgentTree(state.subagents)).map((node) =>
      toAgentViewModel(node.agent, node.depth)
    ),
    economics,
    heartbeat: buildHeartbeat(state),
    feed: calls.map(toFeedItem),
    files: extractFiles(calls),
  };
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

function toAgentViewModel(agent: SubAgentState, depth: number): AgentViewModel {
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
    depth,
    calls: agent.recentToolCalls.length,
    durationMs: callSpanMs(agent.recentToolCalls),
    detail: { calls: calls.map(toFeedItem), files: extractFiles(calls) },
  };
}

/** The main session as the tree's root node: main-only token spend, its own
 *  model + recent activity. Running whenever the session is live or working. */
function toMainAgentViewModel(state: SessionState): AgentViewModel {
  const calls = state.recentToolCalls.slice().reverse(); // most-recent first
  return {
    agentId: MAIN_AGENT_ID,
    type: "main",
    status: state.running || state.isLive ? "running" : "completed",
    tokens: sumUsage(state),
    colorIndex: agentColorIndex(MAIN_AGENT_ID),
    model: state.model,
    depth: 0,
    calls: state.recentToolCalls.length,
    detail: { calls: calls.map(toFeedItem), files: extractFiles(calls) },
  };
}

/** Real elapsed span (ms) across a tool-call ring, first→last by transcript
 *  time. Undefined for fewer than two calls or a zero span — never fabricated. */
function callSpanMs(calls: readonly ToolCallRecord[]): number | undefined {
  if (calls.length < 2) {
    return undefined;
  }
  let min = calls[0].timestamp;
  let max = calls[0].timestamp;
  for (const c of calls) {
    if (c.timestamp < min) {
      min = c.timestamp;
    }
    if (c.timestamp > max) {
      max = c.timestamp;
    }
  }
  return max > min ? max - min : undefined;
}
