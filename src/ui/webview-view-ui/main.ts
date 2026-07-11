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
import { renderHeartbeat } from "./render-heartbeat";
import { renderVitals } from "./render-vitals";

const IDLE_HTML = `<div class="cv-idle">No active Claude Code session in this workspace.</div>`;

// Agent drill-down open/closed state, kept across re-renders (the sidebar
// re-renders on every store change; without this, an expanded agent would
// collapse each tick).
const openAgents = new Set<string>();

function renderSession(s: SessionViewModel): string {
  return `<section class="cv-session">${renderVitals(s)}${renderAgents(s)}${renderEconomics(s)}${renderHeartbeat(
    s
  )}${renderFeed(s)}${renderFiles(s)}</section>`;
}

function render(root: HTMLElement, vm: SidebarViewModel): void {
  root.innerHTML = vm.sessions.length === 0 ? IDLE_HTML : vm.sessions.map(renderSession).join("");
  // Prune remembered expansions for agents that are no longer present, then
  // re-apply the open class to those that are (innerHTML wiped it).
  const present = new Set<string>();
  for (const s of vm.sessions) {
    for (const a of s.agents) {
      present.add(a.agentId);
    }
  }
  for (const id of [...openAgents]) {
    if (!present.has(id)) {
      openAgents.delete(id);
      continue;
    }
    root.querySelector(`.agent[data-agent="${CSS.escape(id)}"]`)?.classList.add("open");
  }
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
  // Delegated agent drill-down toggle — clicking an agent row flips its panel
  // and remembers the choice so the next state push keeps it open.
  root.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest(".agent-row");
    const agent = row?.parentElement;
    if (!agent || !agent.classList.contains("has-detail")) {
      return;
    }
    const id = agent.getAttribute("data-agent");
    if (!id) {
      return;
    }
    if (openAgents.has(id)) {
      openAgents.delete(id);
    } else {
      openAgents.add(id);
    }
    agent.classList.toggle("open");
  });
  // Tell the host we're mounted so it replays the latest state (the first
  // store change may have fired before this webview existed).
  postToHost({ type: "ready" });
}

mount();
