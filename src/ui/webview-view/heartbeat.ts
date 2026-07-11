import { agentColorIndex } from "./agent-color";
import { MAIN_AGENT_ID, SessionState } from "../../core/types";

/** Max heartbeat bars kept — a recent window, not the whole session. */
const HEARTBEAT_MAX = 48;

/**
 * Activity heartbeat: merge the main session's tool calls (main identity color)
 * with every sub-agent's own tool calls (each agent's color), order by real
 * transcript time, and keep the most recent window. Purely derived from
 * `SessionState` — no hooks required.
 */
export function buildHeartbeat(state: SessionState): number[] {
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
