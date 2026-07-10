// Thin typed wrapper around the VS Code webview API for the sidebar client.
// `acquireVsCodeApi()` is injected into the webview's global scope at runtime
// by VS Code (not by any import); declared here as the sole ambient touchpoint
// so every render module gets a typed post/receive pair. Separate from the
// dashboard's `webview-ui/vscode-api.ts` because the two views speak different
// message contracts.
import type { HostToSidebarMessage, SidebarToHostMessage } from "../webview-view/sidebar-messages";

interface VsCodeApi {
  postMessage(message: SidebarToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();

export function postToHost(message: SidebarToHostMessage): void {
  vscodeApi.postMessage(message);
}

export function onHostMessage(handler: (message: HostToSidebarMessage) => void): void {
  window.addEventListener("message", (event: MessageEvent<HostToSidebarMessage>) => handler(event.data));
}
