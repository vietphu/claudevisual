import * as vscode from "vscode";

/**
 * Copies an Advisor tip's prompt text to the clipboard, formatted for pasting
 * straight into a Claude Code chat.
 */
export async function copyAdvisorTip(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage("ClaudeVisual: copied tip to clipboard.");
}
