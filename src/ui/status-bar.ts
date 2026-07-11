import * as vscode from "vscode";
import { formatTokenCount, resolveContextPercent, sumUsage } from "../core/session-display";
import { analyzeSession } from "../core/advisor/advisor-engine";
import { AdvisorResult } from "../core/advisor/advisor-types";
import { resolveAdvisorConfig } from "../config/advisor-plan";
import { SessionState } from "../core/types";

/** Status bar item: `●/○ model · ~context% · total tokens · <advisory>`. Clicking
 *  it opens the dashboard (where the full Efficiency report lives). */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.name = "ClaudeVisual";
    this.item.command = "claudevisual.openDashboard";
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

    const advisor = analyzeSession(primary, resolveAdvisorConfig());
    const top = advisor.recommendations[0];
    // A critical recommendation takes over the trailing slot (with a warning
    // background) so it can't be missed; otherwise show the efficiency grade.
    this.item.backgroundColor =
      top?.severity === "critical" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    const advLabel = advisorLabel(advisor);

    this.item.text = `${dot} ${model} · ${contextLabel} · ${formatTokenCount(totalTokens)} tok${costLabel}${advLabel}`;
    this.item.tooltip = buildTooltip(primary, contextPercent, precise, totalTokens, advisor);
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

/** Trailing status-bar advisory: a critical rec's metric, else the grade (unless
 *  neutral — a just-started session has no meaningful grade to show yet). */
function advisorLabel(advisor: AdvisorResult): string {
  const top = advisor.recommendations[0];
  if (top?.severity === "critical") {
    return ` · $(warning) ${top.metric ?? top.title}`;
  }
  if (advisor.score.neutral) {
    return "";
  }
  return ` · $(lightbulb) ${advisor.score.grade}`;
}

function buildTooltip(
  state: SessionState,
  contextPercent: number,
  precise: boolean,
  totalTokens: number,
  advisor: AdvisorResult
): string {
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
  if (!advisor.score.neutral) {
    lines.push("", `Efficiency: ${advisor.score.grade} (${advisor.score.score}/100)`);
  }
  for (const rec of advisor.recommendations.slice(0, 3)) {
    lines.push(`• [${rec.severity}] ${rec.title}${rec.metric ? ` — ${rec.metric}` : ""}`);
  }
  lines.push("", "Click to open the ClaudeVisual dashboard.");
  return lines.join("\n");
}
