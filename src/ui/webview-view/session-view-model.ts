import { agentColorIndex } from "./agent-color";
import { resolveContextPercent, sumUsage } from "../../core/session-display";
import { estimateCostUsd } from "../../core/model-pricing";
import { tokenEconomics } from "../../core/token-economics";
import { SessionState, SubAgentState, ToolCallRecord } from "../../core/types";
import {
  AgentViewModel,
  EconomicsViewModel,
  FeedItemViewModel,
  FileViewModel,
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

function toAgentViewModel(agent: SubAgentState): AgentViewModel {
  const t = agent.tokens;
  return {
    agentId: agent.agentId,
    type: agent.subagentType,
    status: agent.status,
    tokens: t.inputTokens + t.outputTokens + t.cacheCreationInputTokens + t.cacheReadInputTokens,
    colorIndex: agentColorIndex(agent.agentId),
    model: agent.model,
    spawnReason: agent.spawnReason,
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

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit"]);

/** Most-recent-wins list of files touched, derived from file-tool calls. */
function extractFiles(callsNewestFirst: ToolCallRecord[]): FileViewModel[] {
  const byPath = new Map<string, FileViewModel>();
  for (const call of callsNewestFirst) {
    if (!FILE_TOOLS.has(call.name) || !call.detail || !looksLikePath(call.detail)) {
      continue;
    }
    if (byPath.has(call.detail)) {
      continue; // newest-first: first occurrence is the latest access
    }
    byPath.set(call.detail, {
      path: call.detail,
      base: basename(call.detail),
      dir: dirname(call.detail),
      access: call.name === "Read" ? "read" : "edit",
    });
  }
  return Array.from(byPath.values());
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

/** A file-tool's `detail` is its `file_path`, which can legitimately contain
 *  spaces (e.g. `~/Library/Application Support/...`). Only require it to be
 *  non-empty and path-shaped; the `FILE_TOOLS` gate already ensures it's a path. */
function looksLikePath(detail: string): boolean {
  return detail.length > 0 && (detail.includes("/") || detail.includes("\\") || detail.includes("."));
}

/** Last path separator index, handling both POSIX `/` and Windows `\`. */
function lastSep(p: string): number {
  return Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
}

function basename(p: string): string {
  const clean = p.replace(/[/\\]+$/, "");
  const i = lastSep(clean);
  return i >= 0 ? clean.slice(i + 1) : clean;
}

function dirname(p: string): string {
  const clean = p.replace(/[/\\]+$/, "");
  const i = lastSep(clean);
  return i > 0 ? clean.slice(0, i) : "";
}

function formatClock(ms: number): string {
  if (!ms || ms <= 0) {
    return "";
  }
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
}
