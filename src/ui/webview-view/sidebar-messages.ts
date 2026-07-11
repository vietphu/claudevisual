// Host <-> sidebar-webview message contract. Kept free of any `vscode` or
// `core/*` runtime import (this file is bundled into the browser-context
// sidebar client too), so the view-model here is a plain serializable DTO —
// no Maps, Dates, or class instances cross the boundary.

/** Category a tool call is bucketed into, driving its color + icon in the feed. */
export type ToolCategory = "read" | "edit" | "bash" | "flow" | "agent" | "other";

/** One agent (sub-agent) as shown in the flat agent list. */
export interface AgentViewModel {
  agentId: string;
  type: string;
  status: "running" | "completed";
  tokens: number;
  colorIndex: number;
  model?: string;
  spawnReason?: string;
  /** This agent's own tool calls + files, shown when its row is expanded. */
  detail: AgentDetailViewModel;
}

/** Per-agent drill-down payload (its own recent tool calls + files touched). */
export interface AgentDetailViewModel {
  calls: FeedItemViewModel[];
  files: FileViewModel[];
}

/** One agent's slice of the session token spend (economics stacked bar). */
export interface EconomicsAgentSlice {
  label: string;
  tokens: number;
  colorIndex: number;
}

/** Token spend grouped by model (economics per-model rollup). */
export interface EconomicsModelSlice {
  model: string;
  tokens: number;
}

/** Token + cache economics for a session. */
export interface EconomicsViewModel {
  totalTokens: number;
  cacheReadTokens: number;
  cacheSavedPct: number;
  byAgent: EconomicsAgentSlice[];
  byModel: EconomicsModelSlice[];
}

/** One entry in the recent-activity feed. */
export interface FeedItemViewModel {
  name: string;
  detail?: string;
  category: ToolCategory;
  /** Local `HH:MM:SS`, from the tool call's real transcript timestamp. */
  time: string;
  /** `true` for `Task` spawns — rendered with the dashed "spawn" treatment. */
  spawn: boolean;
}

/** One file the session touched, grouped by directory in the files panel. */
export interface FileViewModel {
  path: string;
  base: string;
  dir: string;
  access: "edit" | "read";
}

/** Everything the sidebar renders for a single session. */
export interface SessionViewModel {
  sessionId: string;
  shortId: string;
  cwd: string;
  model?: string;
  running: boolean;
  live: boolean;
  contextPercent: number;
  contextPrecise: boolean;
  totalTokens: number;
  costUsd?: number;
  /** `true` when `costUsd` is a pricing-table estimate (statusline wrap absent),
   *  `false` when it's the precise statusline-derived cost. */
  costEstimated: boolean;
  agents: AgentViewModel[];
  economics: EconomicsViewModel;
  /** Activity heartbeat: one agent-identity color index per recent tool call
   *  across main + every sub-agent, ordered oldest → newest. Empty when the
   *  session has no recorded tool calls yet. */
  heartbeat: number[];
  feed: FeedItemViewModel[];
  files: FileViewModel[];
}

export interface SidebarViewModel {
  sessions: SessionViewModel[];
}

/** Host → client: the full current view-model (replaces prior render). */
export interface StateMessage {
  type: "state";
  vm: SidebarViewModel;
}

export type HostToSidebarMessage = StateMessage;

/** Client → host: the webview finished mounting and wants the current state. */
export interface ReadyMessage {
  type: "ready";
}

export type SidebarToHostMessage = ReadyMessage;
