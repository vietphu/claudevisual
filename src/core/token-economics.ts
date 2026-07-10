import { MAIN_AGENT_ID, SessionState, SubAgentState, TokenUsage } from "./types";

/** One agent's slice of the session's total token spend (for the stacked bar). */
export interface AgentTokenSlice {
  agentId: string;
  label: string;
  tokens: number;
}

/** Token spend grouped by model (for the per-model rollup). */
export interface ModelTokenSlice {
  model: string;
  tokens: number;
}

export interface TokenEconomics {
  /** Main session spend + every sub-agent's spend, summed for display only. */
  totalTokens: number;
  cacheReadTokens: number;
  /** `cacheRead / total * 100`, rounded. 0 when there is no spend. */
  cacheSavedPct: number;
  byAgent: AgentTokenSlice[];
  byModel: ModelTokenSlice[];
}

function total(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/**
 * Pure aggregation of a session's token economics for the sidebar. Folds the
 * MAIN session's `cumulativeUsage` (attributed to `state.model`) together with
 * each sub-agent's own `tokens` + `model`.
 *
 * IMPORTANT: this summation is for *display* only. It must never be written
 * back into `cumulativeUsage` — the reducer's invariant is that sub-agent usage
 * is its own and never feeds the parent turn's cumulative total.
 */
export function tokenEconomics(state: SessionState): TokenEconomics {
  const subagents = Array.from(state.subagents.values());
  const byAgent = buildAgentSlices(state, subagents);
  const byModel = buildModelSlices(state, subagents);

  const totalTokens = byAgent.reduce((sum, a) => sum + a.tokens, 0);
  const cacheReadTokens =
    state.cumulativeUsage.cacheReadInputTokens +
    subagents.reduce((sum, a) => sum + a.tokens.cacheReadInputTokens, 0);

  return {
    totalTokens,
    cacheReadTokens,
    cacheSavedPct: totalTokens > 0 ? Math.round((cacheReadTokens / totalTokens) * 100) : 0,
    byAgent,
    byModel,
  };
}

function buildAgentSlices(state: SessionState, subagents: SubAgentState[]): AgentTokenSlice[] {
  const slices: AgentTokenSlice[] = [];
  const mainTokens = total(state.cumulativeUsage);
  if (mainTokens > 0) {
    slices.push({ agentId: MAIN_AGENT_ID, label: "main", tokens: mainTokens });
  }
  for (const a of subagents) {
    slices.push({ agentId: a.agentId, label: a.subagentType, tokens: total(a.tokens) });
  }
  return slices;
}

function buildModelSlices(state: SessionState, subagents: SubAgentState[]): ModelTokenSlice[] {
  const byModel = new Map<string, number>();
  const add = (model: string | undefined, tokens: number): void => {
    if (tokens <= 0) {
      return;
    }
    const key = model ?? "unknown";
    byModel.set(key, (byModel.get(key) ?? 0) + tokens);
  };
  add(state.model, total(state.cumulativeUsage));
  for (const a of subagents) {
    add(a.model, total(a.tokens));
  }
  return Array.from(byModel.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((x, y) => y.tokens - x.tokens);
}
