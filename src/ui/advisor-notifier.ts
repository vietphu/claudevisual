import * as vscode from "vscode";
import { analyzeSession } from "../core/advisor/advisor-engine";
import { resolveAdvisorConfig } from "../config/advisor-plan";
import { SessionState } from "../core/types";

/**
 * Fires a VS Code notification the first time a session enters a *critical*
 * advisor condition, and not again until that exact condition clears — so a
 * context-almost-full warning toasts once per crossing, never once per store
 * tick. Off entirely when `claudevisual.advisor.notifyCritical` is false.
 *
 * Dedupe key is `sessionId|recommendationId`; the id is stable per condition
 * (e.g. "context-critical"), so re-firing only happens after the key leaves the
 * active set and later returns.
 */
export class AdvisorNotifier implements vscode.Disposable {
  /** Keys currently in a critical state that have already been notified. */
  private readonly active = new Set<string>();

  update(sessions: readonly SessionState[]): void {
    if (!notifyEnabled()) {
      // Reset so re-enabling the setting notifies afresh rather than staying
      // silent on conditions that were active while it was off.
      this.active.clear();
      return;
    }
    const config = resolveAdvisorConfig();
    const stillActive = new Set<string>();

    for (const session of sessions) {
      const result = analyzeSession(session, config);
      for (const rec of result.recommendations) {
        if (rec.severity !== "critical") {
          continue;
        }
        const key = `${session.sessionId}|${rec.id}`;
        stillActive.add(key);
        if (this.active.has(key)) {
          continue; // already told the user about this one
        }
        this.active.add(key);
        void this.notify(rec.title, rec.detail);
      }
    }

    // Drop keys whose condition has cleared, so it can re-fire if it recurs.
    for (const key of [...this.active]) {
      if (!stillActive.has(key)) {
        this.active.delete(key);
      }
    }
  }

  private async notify(title: string, detail: string | undefined): Promise<void> {
    const message = detail ? `${title} — ${detail}` : title;
    const choice = await vscode.window.showWarningMessage(`ClaudeVisual: ${message}`, "Open Dashboard", "Dismiss");
    if (choice === "Open Dashboard") {
      void vscode.commands.executeCommand("claudevisual.openDashboard");
    }
  }

  dispose(): void {
    this.active.clear();
  }
}

function notifyEnabled(): boolean {
  return vscode.workspace.getConfiguration("claudevisual").get<boolean>("advisor.notifyCritical", true);
}
