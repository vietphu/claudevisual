import type { AgentDetailViewModel, AgentViewModel, SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatTokens, modelChip } from "./dom-utils";

/** Flat agent (sub-agent) list. Each row shows identity color, type, status,
 *  model, token spend, and spawn reason; rows with recorded activity expand to
 *  a drill-down of that agent's own tool calls + files touched. */
export function renderAgents(s: SessionViewModel): string {
  const body =
    s.agents.length === 0
      ? `<div class="empty">No sub-agents spawned yet</div>`
      : s.agents.map(renderAgent).join("");

  return `
  <div class="section">
    <div class="lbl">Agents <span class="line"></span><span class="count">${s.agents.length}</span></div>
    <div class="agents">${body}</div>
  </div>`;
}

function renderAgent(a: AgentViewModel): string {
  const glyph = a.status === "running" ? "▶" : "✓";
  const reason = a.spawnReason ? `<div class="areason" title="${esc(a.spawnReason)}">${esc(a.spawnReason)}</div>` : "";
  const hasDetail = a.detail.calls.length > 0 || a.detail.files.length > 0;
  const caret = hasDetail ? `<span class="caret">›</span>` : `<span class="caret hidden"></span>`;

  return `
  <div class="agent${hasDetail ? " has-detail" : ""}" data-agent="${esc(a.agentId)}">
    <div class="agent-row" data-status="${a.status}" style="--ac:var(--a${a.colorIndex})">
      ${caret}
      <span class="st">${glyph}</span>
      <span class="adot"></span>
      <div class="abody">
        <div class="atop">
          <span class="aname" title="${esc(a.type)}">${esc(a.type)}</span>
          <span class="ameta">${modelChip(a.model)}<span class="atok">${formatTokens(a.tokens)}</span></span>
        </div>
        ${reason}
      </div>
    </div>
    ${hasDetail ? renderDrill(a.detail) : ""}
  </div>`;
}

function renderDrill(detail: AgentDetailViewModel): string {
  const calls = detail.calls
    .slice(0, 10)
    .map(
      (c) =>
        `<div class="drow" data-cat="${c.category}"><span class="dtool">${esc(c.name)}</span><span class="ddet">${esc(
          c.detail ?? ""
        )}</span></div>`
    )
    .join("");
  const files = detail.files.length
    ? `<div class="dfiles">${detail.files
        .map((f) => `<span class="dfile ${f.access}" title="${esc(f.path)}">${esc(f.base)}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="adrill">${calls}${files}</div>`;
}
