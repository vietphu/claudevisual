// Sidebar WebviewView entry point — bundled by esbuild's browser-target
// `sidebarViewConfig` (esbuild.js) into dist/webview-view/main.js, referenced
// by sidebar-view-provider.ts's HTML. Renders the session view-model the host
// pushes on every store change.
import type { SessionViewModel, SidebarViewModel } from "../webview-view/sidebar-messages";
import { onHostMessage, postToHost } from "./sidebar-vscode-api";
import { renderAgents } from "./render-agents";
import { renderEconomics } from "./render-economics";
import { renderFeed } from "./render-feed";
import { renderFiles } from "./render-files";
import { renderVitals } from "./render-vitals";

const IDLE_HTML = `<div class="cv-idle">No active Claude Code session in this workspace.</div>`;

function renderSession(s: SessionViewModel): string {
  return `<section class="cv-session">${renderVitals(s)}${renderAgents(s)}${renderEconomics(s)}${renderFeed(s)}${renderFiles(s)}</section>`;
}

function render(root: HTMLElement, vm: SidebarViewModel): void {
  root.innerHTML = vm.sessions.length === 0 ? IDLE_HTML : vm.sessions.map(renderSession).join("");
}

function mount(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  onHostMessage((message) => {
    if (message.type === "state") {
      render(root, message.vm);
    }
  });
  // Tell the host we're mounted so it replays the latest state (the first
  // store change may have fired before this webview existed).
  postToHost({ type: "ready" });
}

mount();
