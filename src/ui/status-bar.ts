import * as vscode from "vscode";
import { formatTokenCount, resolveContextPercent, sumUsage } from "../core/session-display";
import { SessionState } from "../core/types";

/** Status bar item: `●/○ model · ~context% · total tokens`. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.name = "ClaudeVisual";
    this.renderIdle();
    this.item.show();
  }

  render(sessions: SessionState[]): void {
    const primary = pickPrimarySession(sessions);
    if (!primary) {
      this.renderIdle();
      return;
    }

    const model = primary.model ?? "unknown model";
    const { percent: contextPercent, precise } = resolveContextPercent(primary);
    const totalTokens = sumUsage(primary);
    const dot = primary.isLive ? "$(circle-filled)" : "$(circle-outline)";
    const contextLabel = `${precise ? "" : "~"}${contextPercent}%`;
    const costLabel = primary.preciseCostUsd !== undefined ? ` · $${primary.preciseCostUsd.toFixed(2)}` : "";

    this.item.text = `${dot} ${model} · ${contextLabel} · ${formatTokenCount(totalTokens)} tok${costLabel}`;
    this.item.tooltip = buildTooltip(primary, contextPercent, precise, totalTokens);
  }

  dispose(): void {
    this.item.dispose();
  }

  private renderIdle(): void {
    this.item.text = "$(circle-outline) ClaudeVisual: idle";
    this.item.tooltip = "No active Claude Code session detected for this workspace";
  }
}

function pickPrimarySession(sessions: SessionState[]): SessionState | undefined {
  return sessions.slice().sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)[0];
}

function buildTooltip(state: SessionState, contextPercent: number, precise: boolean, totalTokens: number): string {
  const lines = [
    `Session: ${state.sessionId}`,
    `Model: ${state.model ?? "unknown"}`,
    precise ? `Context used: ${contextPercent}%` : `Context used (approx.): ~${contextPercent}%`,
    `Cumulative tokens this session: ${totalTokens}`,
  ];
  if (state.preciseCostUsd !== undefined) {
    lines.push(`Cost (session): $${state.preciseCostUsd.toFixed(2)}`);
  }
  lines.push(`Permission mode: ${state.permissionMode ?? "unknown"}`, `Status: ${state.isLive ? "live" : "idle"}`);
  return lines.join("\n");
}
