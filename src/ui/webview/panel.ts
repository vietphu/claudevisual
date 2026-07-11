import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { SessionMetricsDiff, SessionStateStore } from "../../core/session-state-store";
import { logError } from "../../diagnostics/logger";
import { analyzeSession } from "../../core/advisor/advisor-engine";
import { SessionState } from "../../core/types";
import { resolveAdvisorConfig } from "../../config/advisor-plan";
import { buildChartPoints } from "./charts";
import { ConfigFormController } from "./config-form";
import type { AdvisorReport, HostToWebviewMessage, WebviewToHostMessage } from "./messages";

/**
 * Singleton dashboard WebviewPanel — "ClaudeVisual: Open Dashboard" reveals
 * the existing panel instead of ever creating a second one.
 * `retainContextWhenHidden: true` per phase spec: the charts' rolling series
 * live entirely in the webview's own JS heap (see webview-ui/chart-view.ts),
 * and losing that state every time the user switches editor tabs would
 * defeat the "live incremental" chart requirement.
 */
export class DashboardPanel implements vscode.Disposable {
  private static current: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly configForm: ConfigFormController;
  private readonly store: SessionStateStore;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext, store: SessionStateStore): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      return;
    }
    DashboardPanel.current = new DashboardPanel(context, store);
  }

  private constructor(context: vscode.ExtensionContext, store: SessionStateStore) {
    this.store = store;
    this.panel = vscode.window.createWebviewPanel(
      "claudevisual.dashboard",
      "ClaudeVisual Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "dist", "webview"))],
      }
    );

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.configForm = new ConfigFormController(context.extensionPath, context.globalState, workspaceRoot);
    this.panel.webview.html = this.renderHtml(context);

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => void this.handleMessage(message)),
      store.onDidChangeMetrics((diffs) => this.postMetrics(diffs)),
      // Full snapshots drive the retrospective Efficiency report (the metrics
      // diff only carries changed sessions; the report wants the current
      // primary session's whole state).
      store.onDidChange((sessions) => this.postAdvisorReport(sessions)),
      // Multi-root workspace edge case: if folders change while the panel is
      // open, only the config form's write-scope target is re-resolved here.
      // The panel stays bound to the `store` instance it was created with;
      // extension.ts recreates a fresh store on folder changes, so a panel
      // opened before a folder change stops receiving further metrics ticks
      // from the old (disposed) store. Acceptable v1 limitation — closing and
      // reopening the dashboard after a workspace-folder change picks up the
      // new store via `DashboardPanel.createOrShow`'s singleton reset on dispose.
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.configForm.setWorkspaceRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
      })
    );
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  private postMetrics(diffs: SessionMetricsDiff[]): void {
    const points = buildChartPoints(diffs);
    if (points.length === 0) {
      return;
    }
    this.post({ type: "metrics-diff", points });
  }

  /** Analyzes the primary (most-recently-updated) session and posts its Efficiency
   *  report. Mirrors the sidebar's "primary session" choice so both agree. */
  private postAdvisorReport(sessions: readonly SessionState[]): void {
    this.post({ type: "advisor-report", report: buildAdvisorReport(sessions) });
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  /**
   * `config-form.ts`'s write/toggle/undo handlers already catch their own
   * errors and resolve to an `{ok: false, error}` result (never throw) — this
   * try/catch exists for the one path that doesn't go through that
   * result-returning contract, `buildInitMessage()`, so a read failure while
   * seeding the form (e.g. a permissions error on `~/.claude/settings.json`)
   * surfaces to the user instead of becoming a silent unhandled rejection.
   */
  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    try {
      if (message.type === "ready") {
        this.post(await this.configForm.buildInitMessage());
        // Replay the current report too: the first store change may have fired
        // before this webview mounted.
        this.postAdvisorReport(this.store.snapshot());
        return;
      }
      const result = await this.configForm.handleMessage(message);
      if (result) {
        this.post(result);
      }
    } catch (err) {
      logError("dashboard panel failed to handle webview message", err);
      void vscode.window.showErrorMessage(
        `ClaudeVisual: dashboard error — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private renderHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(context.extensionPath, "dist", "webview", "main.js"))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(context.extensionPath, "dist", "webview", "dashboard.css"))
    );
    const nonce = crypto.randomBytes(16).toString("base64");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>ClaudeVisual Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Picks the most-recently-updated session and flattens its `AdvisorResult` into
 *  the serializable `AdvisorReport` DTO. Returns null when there's no session. */
function buildAdvisorReport(sessions: readonly SessionState[]): AdvisorReport | null {
  let primary: SessionState | undefined;
  for (const s of sessions) {
    if (!primary || s.lastUpdatedAt > primary.lastUpdatedAt) {
      primary = s;
    }
  }
  if (!primary) {
    return null;
  }
  const result = analyzeSession(primary, resolveAdvisorConfig());
  return {
    sessionId: primary.sessionId,
    sessionLabel: primary.title || basename(primary.cwd) || primary.sessionId.slice(0, 8),
    model: primary.model,
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

function basename(p: string): string {
  const clean = p.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i >= 0 ? clean.slice(i + 1) : clean;
}
