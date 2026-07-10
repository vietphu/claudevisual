import type { AgentViewModel, SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatTokens, modelChip } from "./dom-utils";

/** Flat agent (sub-agent) list. Nesting + drill-down arrive in later phases;
 *  Phase 1 shows each agent's identity color, type, status, and token spend. */
export function renderAgents(s: SessionViewModel): string {
  const body =
    s.agents.length === 0
      ? `<div class="empty">No sub-agents spawned yet</div>`
      : s.agents.map(renderAgentRow).join("");

  return `
  <div class="section">
    <div class="lbl">Agents <span class="line"></span><span class="count">${s.agents.length}</span></div>
    <div class="agents">${body}</div>
  </div>`;
}

function renderAgentRow(a: AgentViewModel): string {
  const glyph = a.status === "running" ? "▶" : "✓";
  const reason = a.spawnReason ? `<div class="areason" title="${esc(a.spawnReason)}">${esc(a.spawnReason)}</div>` : "";
  return `
  <div class="agent-row" data-status="${a.status}" style="--ac:var(--a${a.colorIndex})">
    <span class="st">${glyph}</span>
    <span class="adot"></span>
    <div class="abody">
      <div class="atop">
        <span class="aname" title="${esc(a.type)}">${esc(a.type)}</span>
        <span class="ameta">${modelChip(a.model)}<span class="atok">${formatTokens(a.tokens)}</span></span>
      </div>
      ${reason}
    </div>
  </div>`;
}
