import { agentColorIndex } from "./agent-color";
import { formatClock } from "./feed-item";
import { MAIN_AGENT_ID, SessionState, ToolCallRecord } from "../../core/types";
import { HeartbeatSample } from "./sidebar-messages";

/** Max heartbeat bars kept — a recent window, not the whole session. */
const HEARTBEAT_MAX = 48;

interface RawSample {
  ts: number;
  colorIndex: number;
  label: string;
  call: ToolCallRecord;
}

/**
 * Activity heartbeat: merge the main session's tool calls (main identity color)
 * with every sub-agent's own tool calls (each agent's color), order by real
 * transcript time, and keep the most recent window. Purely derived from
 * `SessionState` — no hooks required.
 */
export function buildHeartbeat(state: SessionState): HeartbeatSample[] {
  const samples: RawSample[] = [];
  const mainColor = agentColorIndex(MAIN_AGENT_ID);
  for (const call of state.recentToolCalls) {
    samples.push({ ts: call.timestamp, colorIndex: mainColor, label: "main", call });
  }
  for (const agent of state.subagents.values()) {
    const color = agentColorIndex(agent.agentId);
    for (const call of agent.recentToolCalls) {
      samples.push({ ts: call.timestamp, colorIndex: color, label: agent.subagentType, call });
    }
  }
  samples.sort((a, b) => a.ts - b.ts);
  const tail = samples.length > HEARTBEAT_MAX ? samples.slice(samples.length - HEARTBEAT_MAX) : samples;
  return tail.map((s) => ({
    colorIndex: s.colorIndex,
    label: s.label,
    tool: s.call.name,
    ts: s.ts,
    time: formatClock(s.call.timestamp),
  }));
}
