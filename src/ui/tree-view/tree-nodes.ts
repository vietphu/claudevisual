import * as vscode from "vscode";
import { SessionState, SubAgentState, ToolCallRecord } from "../../core/types";

export type CategoryKind = "subagents" | "skills" | "toolcalls";
export type TreeNode = SessionNode | CategoryNode | SubAgentNode | SkillNode | ToolCallNode;

/** Root node: one per session, keyed strictly by `sessionId`. Two concurrent
 * sessions sharing the same `cwd` render as separate sibling `SessionNode`s
 * because each carries its own `session.sessionId` identity, never merged. */
export class SessionNode extends vscode.TreeItem {
  readonly kind = "session" as const;

  constructor(readonly session: SessionState) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.Expanded);
    this.id = `session:${session.sessionId}`;
    this.description = session.cwd;
    this.iconPath = new vscode.ThemeIcon(session.isLive ? "circle-filled" : "circle-outline");
    this.contextValue = "claudevisual.session";
    this.tooltip = buildSessionTooltip(session);
  }
}

/** One of the three fixed sub-sections under a session: sub-agents, skills, tool calls. */
export class CategoryNode extends vscode.TreeItem {
  readonly kind = "category" as const;

  constructor(readonly categoryKind: CategoryKind, readonly sessionId: string, label: string, count: number) {
    super(
      `${label} (${count})`,
      count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.id = `category:${sessionId}:${categoryKind}`;
    this.contextValue = `claudevisual.category.${categoryKind}`;
  }
}

export class SubAgentNode extends vscode.TreeItem {
  readonly kind = "subagent" as const;

  constructor(sessionId: string, readonly subagent: SubAgentState) {
    super(subagent.subagentType, vscode.TreeItemCollapsibleState.None);
    this.id = `subagent:${sessionId}:${subagent.agentId}`;
    this.description = describeSubAgentStatus(subagent);
    this.iconPath = new vscode.ThemeIcon(subagent.status === "running" ? "sync~spin" : "check");
    this.contextValue = "claudevisual.subagent";
    this.tooltip = buildSubAgentTooltip(subagent);
  }
}

export class SkillNode extends vscode.TreeItem {
  readonly kind = "skill" as const;

  constructor(sessionId: string, skillName: string, index: number) {
    super(skillName, vscode.TreeItemCollapsibleState.None);
    this.id = `skill:${sessionId}:${index}:${skillName}`;
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.contextValue = "claudevisual.skill";
  }
}

export class ToolCallNode extends vscode.TreeItem {
  readonly kind = "toolcall" as const;

  constructor(sessionId: string, readonly call: ToolCallRecord, index: number) {
    super(call.name, vscode.TreeItemCollapsibleState.None);
    this.id = `toolcall:${sessionId}:${index}:${call.timestamp}`;
    this.description = call.detail ?? formatTime(call.timestamp);
    this.iconPath = new vscode.ThemeIcon("tools");
    this.contextValue = "claudevisual.toolcall";
    this.tooltip = call.detail ? `${call.name}: ${call.detail}` : call.name;
  }
}

function sessionLabel(session: SessionState): string {
  const shortId = session.sessionId.slice(0, 8);
  return session.model ? `${session.model} · ${shortId}` : shortId;
}

function buildSessionTooltip(session: SessionState): string {
  return [
    `Session: ${session.sessionId}`,
    `Cwd: ${session.cwd}`,
    `Model: ${session.model ?? "unknown"}`,
    `Permission mode: ${session.permissionMode ?? "unknown"}`,
    `Status: ${session.isLive ? "live" : "idle"}`,
  ].join("\n");
}

function describeSubAgentStatus(subagent: SubAgentState): string {
  const total =
    subagent.tokens.inputTokens +
    subagent.tokens.outputTokens +
    subagent.tokens.cacheCreationInputTokens +
    subagent.tokens.cacheReadInputTokens;
  return `${subagent.status} · ${total} tok`;
}

function buildSubAgentTooltip(subagent: SubAgentState): string {
  return [
    `Sub-agent: ${subagent.subagentType}`,
    `Agent id: ${subagent.agentId}`,
    `Status: ${subagent.status}`,
    `Started: ${formatTime(subagent.startedAt)}`,
    `Last update: ${formatTime(subagent.lastUpdatedAt)}`,
  ].join("\n");
}

function formatTime(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleTimeString() : "unknown";
}
