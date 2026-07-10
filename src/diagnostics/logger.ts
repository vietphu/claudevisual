import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
let debugEnabled = false;

export function initLogger(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel("ClaudeVisual");
  context.subscriptions.push(channel);
  refreshDebugSetting();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudevisual.debug")) {
        refreshDebugSetting();
      }
    })
  );
}

function refreshDebugSetting(): void {
  debugEnabled = vscode.workspace.getConfiguration("claudevisual").get<boolean>("debug", false);
}

/** Gated behind the `claudevisual.debug` setting — never logs transcript contents at default level. */
export function logDebug(message: string): void {
  if (debugEnabled) {
    channel?.appendLine(`[debug] ${message}`);
  }
}

export function logInfo(message: string): void {
  channel?.appendLine(`[info] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const suffix = err instanceof Error ? `: ${err.message}` : "";
  channel?.appendLine(`[error] ${message}${suffix}`);
}
