import type { SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatTokens, modelChip } from "./dom-utils";

/** Threshold band for the context ring color — good < 75 <= warn < 90 <= crit. */
function ringClass(percent: number): string {
  if (percent >= 90) {
    return "ring-crit";
  }
  if (percent >= 75) {
    return "ring-warn";
  }
  return "ring-good";
}

/** Vitals header: live pulse, session name + id, model chip, context ring,
 *  total tokens, and cost (precise from statusline, else a labelled estimate). */
export function renderVitals(s: SessionViewModel): string {
  const dotClass = s.running ? "dot running" : s.live ? "dot live" : "dot idle";
  const statusLabel = s.running ? "working" : s.live ? "live" : "idle";
  const ctx = `${s.contextPrecise ? "" : "~"}${s.contextPercent}%`;
  const cost =
    s.costUsd !== undefined
      ? `<div class="stat"><b class="good">${s.costEstimated ? "~" : ""}$${s.costUsd.toFixed(2)}</b><u>cost${s.costEstimated ? " · est" : ""}</u></div>`
      : "";
  const burn =
    s.running || s.burnRatePerMin !== undefined
      ? `<div class="stat"><b>${s.burnRatePerMin !== undefined ? `~${formatTokens(s.burnRatePerMin)}` : "—"}</b><u>tok/min</u></div>`
      : "";

  return `
  <div class="vitals">
    <div class="v-top">
      <span class="${dotClass}" title="${statusLabel}"></span>
      <div class="v-head">
        <div class="v-name" title="${esc(s.cwd)}">${esc(basename(s.cwd) || s.shortId)}</div>
        <div class="v-id">${esc(s.shortId)} · ${statusLabel}</div>
      </div>
      ${modelChip(s.model)}
    </div>
    <div class="v-grid">
      <div class="ring ${ringClass(s.contextPercent)}" style="--p:${s.contextPercent}">
        <i><b>${ctx}</b><span>context</span></i>
      </div>
      <div class="stats">
        <div class="stat"><b>${formatTokens(s.totalTokens)}</b><u>tokens</u></div>
        ${cost}
        <div class="stat"><b>${s.agents.length}</b><u>agents</u></div>
        ${burn}
      </div>
    </div>
  </div>`;
}

function basename(p: string): string {
  const clean = p.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i >= 0 ? clean.slice(i + 1) : clean;
}
