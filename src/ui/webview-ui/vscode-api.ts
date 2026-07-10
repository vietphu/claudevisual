// Thin typed wrapper around the VS Code webview API — `acquireVsCodeApi()`
// is injected into the webview's global scope at runtime by VS Code itself,
// not by any import; declared here as the sole ambient ("declare function")
// touchpoint so every other webview-ui module gets a typed `postToHost`/
// `onHostMessage` pair instead of reaching for the untyped global directly.
import type { HostToWebviewMessage, WebviewToHostMessage } from "../webview/messages";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

export function onHostMessage(handler: (message: HostToWebviewMessage) => void): void {
  window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => handler(event.data));
}
