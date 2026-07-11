import { agentColorIndex } from "./agent-color";
import { buildAgentTree, flattenAgentTree } from "../../core/agent-tree";
import { toFeedItem } from "./feed-item";
import { buildHeartbeat } from "./heartbeat";
import { resolveContextPercent, sumUsage } from "../../core/session-display";
import { estimateCostFromState } from "../../core/model-pricing";
import { tokenEconomics } from "../../core/token-economics";
import { analyzeSession } from "../../core/advisor/advisor-engine";
import { AdvisorConfig, DEFAULT_ADVISOR_CONFIG } from "../../core/advisor/advisor-config";
import { AdvisorResult } from "../../core/advisor/advisor-types";
import { MAIN_AGENT_ID, SessionState, SubAgentState, ToolCallRecord } from "../../core/types";
import { extractFiles } from "./touched-files";
import { AdvisorViewModel, AgentViewModel, EconomicsViewModel, SessionViewModel, SidebarViewModel } from "./sidebar-messages";

/**
 * Pure host-side transform: `SessionState[]` (rich in-memory model, holds Maps)
 * → `SidebarViewModel` (flat serializable DTO the webview renders). vscode-free
 * and side-effect-free so it is unit-testable without the editor host.
 *
 * Phase 1/2 scope: vitals, a flat agent list, economics, the recent-activity
 * feed, and the files-touched panel — all from data already in `SessionState`.
 */
export function toSidebarViewModel(
  sessions: readonly SessionState[],
  advisorConfig: AdvisorConfig = DEFAULT_ADVISOR_CONFIG
): SidebarViewModel {
  const ordered = sessions.slice().sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  return { sessions: ordered.map((s) => toSessionViewModel(s, advisorConfig)) };
}

function toSessionViewModel(state: SessionState, advisorConfig: AdvisorConfig): SessionViewModel {
  const { percent, precise, usedTokens, windowTokens } = resolveContextPercent(state);
  const calls = state.recentToolCalls.slice().reverse(); // most-recent first
  const economics = toEconomics(state);
  const { costUsd, costEstimated } = resolveCost(state);
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
    totalTokens: economics.totalTokens,
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
    advisor: toAdvisor(analyzeSession(state, advisorConfig)),
    heartbeat: buildHeartbeat(state),
    feed: calls.map(toFeedItem),
    files: extractFiles(calls),
  };
}

/** Flatten the core `AdvisorResult` into the serializable sidebar DTO. */
function toAdvisor(result: AdvisorResult): AdvisorViewModel {
  return {
    score: result.score.score,
    grade: result.score.grade,
    neutral: result.score.neutral,
    dimensions: result.score.dimensions.map((d) => ({ key: d.key, label: d.label, score: d.score })),
    recommendations: result.recommendations.map((r) => ({
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      detail: r.detail,
      metric: r.metric,
    })),
    costDisplay: result.cost?.display,
    costTooltip: result.cost?.tooltip,
  };
}

/** Precise statusline cost wins; otherwise fall back to a split-bucket pricing
 *  estimate (input/output/cache-write/cache-read priced separately — cache-read
 *  is ~10x cheaper than input, so a flat blended rate over all buckets would
 *  overstate cost on long, cache-heavy sessions) across main + every sub-agent
 *  (flagged `costEstimated`). Same formula the Efficiency Advisor uses, so the
 *  two never disagree. */
function resolveCost(state: SessionState): { costUsd?: number; costEstimated: boolean } {
  if (state.preciseCostUsd !== undefined) {
    return { costUsd: state.preciseCostUsd, costEstimated: false };
  }
  return { costUsd: estimateCostFromState(state), costEstimated: true };
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
