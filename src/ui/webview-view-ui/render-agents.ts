import type { AgentDetailViewModel, AgentViewModel, SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatDuration, formatTokens, modelChip } from "./dom-utils";

/** Orchestration tree. The main session is the synthetic root; spawned
 *  sub-agents nest beneath it, pre-order and indented by `depth`. Each row shows
 *  identity color, type, status, model, token spend, and spawn reason. Running
 *  rows show an honest `N calls` activity proxy; completed rows show their
 *  elapsed duration. Rows with recorded activity expand to a drill-down of their
 *  own tool calls + files touched. */
export function renderAgents(s: SessionViewModel): string {
  if (!s.mainAgent && s.agents.length === 0) {
    return `
  <div class="section">
    <div class="lbl">Orchestration <span class="line"></span><span class="count">0</span></div>
    <div class="agents"><div class="empty">No sub-agents spawned yet</div></div>
  </div>`;
  }

  const running = s.agents.filter((a) => a.status === "running").length;
  const badge =
    running > 0
      ? `<span class="liveN"><span class="d"></span>${running} running</span>`
      : `<span class="count">${s.agents.length}</span>`;

  // Main is the visible root at depth 0; every sub-agent renders one level
  // deeper so the tree reads main → children → grandchildren.
  const rows = [
    ...(s.mainAgent ? [renderAgent(s.mainAgent, 0)] : []),
    ...s.agents.map((a) => renderAgent(a, s.mainAgent ? 1 : 0)),
  ].join("");

  return `
  <div class="section">
    <div class="lbl">Orchestration <span class="line"></span>${badge}</div>
    <div class="agents">${rows}</div>
  </div>`;
}

function renderAgent(a: AgentViewModel, depthOffset: number): string {
  const depth = a.depth + depthOffset;
  const glyph = a.status === "running" ? "▶" : "✓";
  const reason = a.spawnReason ? `<div class="areason" title="${esc(a.spawnReason)}">${esc(a.spawnReason)}</div>` : "";
  const hasDetail = a.detail.calls.length > 0 || a.detail.files.length > 0;
  const caret = hasDetail ? `<span class="caret">›</span>` : `<span class="caret hidden"></span>`;
  // Running agents show an honest activity proxy (raw call count, not a
  // fabricated %); completed agents show how long their activity spanned.
  const meta =
    a.status === "running"
      ? a.calls > 0
        ? `<span class="acalls">${a.calls} calls</span>`
        : ""
      : a.durationMs !== undefined
        ? `<span class="adur">${formatDuration(a.durationMs)}</span>`
        : "";

  return `
  <div class="agent${hasDetail ? " has-detail" : ""}${depth > 0 ? " nested" : ""}" data-agent="${esc(
    a.agentId
  )}" style="--depth:${depth}">
    <div class="agent-row" data-status="${a.status}" style="--ac:var(--a${a.colorIndex})">
      ${caret}
      <span class="st">${glyph}</span>
      <span class="adot"></span>
      <div class="abody">
        <div class="atop">
          <span class="aname" title="${esc(a.type)}">${esc(a.type)}</span>
          <span class="ameta">${meta}${modelChip(a.model)}<span class="atok">${formatTokens(a.tokens)}</span></span>
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
