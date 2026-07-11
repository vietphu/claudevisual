import type { SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatTokens, formatUsd, modelChip } from "./dom-utils";

/** Severity band driving the meter's fill/text color — good < 75 <= warn < 90 <= crit. */
function severityClass(percent: number): "good" | "warn" | "crit" {
  if (percent >= 90) {
    return "crit";
  }
  if (percent >= 75) {
    return "warn";
  }
  return "good";
}

/** Vitals header: live pulse, session name + id, model chip, a full-width context
 *  meter (used/window tokens + %), and a single-row stat strip (tokens, cost, agents,
 *  burn rate). A horizontal meter reads the absolute + relative numbers in one line,
 *  where the previous ring could only fit the percent and needed a separate line below it. */
export function renderVitals(s: SessionViewModel): string {
  const dotClass = s.running ? "dot running" : s.live ? "dot live" : "dot idle";
  const statusLabel = s.running ? "working" : s.live ? "live" : "idle";
  const ctxPct = `${s.contextPrecise ? "" : "~"}${s.contextPercent}%`;
  const sev = severityClass(s.contextPercent);
  const ctxDetail = `${formatTokens(s.contextUsedTokens)} / ${formatTokens(s.contextWindowTokens)} tokens`;
  const cost =
    s.costUsd !== undefined
      ? `<div class="stat"><b class="good">${s.costEstimated ? "~" : ""}${formatUsd(s.costUsd)}</b><u>cost${s.costEstimated ? " · est" : ""}</u></div>`
      : "";
  const burn =
    s.running || s.burnRatePerMin !== undefined
      ? `<div class="stat"><b>${s.burnRatePerMin !== undefined ? `~${formatTokens(s.burnRatePerMin)}` : "—"}</b><u>tok/min</u></div>`
      : "";

  return `
  <div class="vitals">
    <div class="v-top">
      <span class="${dotClass}" aria-hidden="true" title="${statusLabel}"></span>
      <div class="v-head">
        <div class="v-name" title="${esc(s.cwd)}">${esc(basename(s.cwd) || s.shortId)}</div>
        <div class="v-id">${esc(s.shortId)} · ${statusLabel}</div>
      </div>
      ${modelChip(s.model)}
    </div>
    <div class="v-meter" title="${ctxDetail} (${ctxPct})">
      <div class="v-meter-row">
        <span class="v-meter-label">Context</span>
        <span class="v-meter-value">${ctxDetail} <b class="${sev}">${ctxPct}</b></span>
      </div>
      <div class="v-meter-track">
        <div class="v-meter-fill ${sev}" style="width:${Math.min(100, s.contextPercent)}%"></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>${formatTokens(s.totalTokens)}</b><u>tokens</u></div>
      ${cost}
      <div class="stat"><b>${s.agents.length}</b><u>agents</u></div>
      ${burn}
    </div>
  </div>`;
}

function basename(p: string): string {
  const clean = p.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i >= 0 ? clean.slice(i + 1) : clean;
}
