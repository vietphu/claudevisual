import type {
  EconomicsAgentSlice,
  EconomicsModelSlice,
  EconomicsViewModel,
  SessionViewModel,
} from "../webview-view/sidebar-messages";
import { esc, formatTokens, modelTier } from "./dom-utils";

/**
 * Token economics: stacked-by-agent bar with its own agent legend, then a
 * separately-labeled per-model rollup, then the cache-savings line.
 *
 * IMPORTANT: the bar/agent legend and the model rollup are two different
 * axes over the same tokens (which agent spent them vs. which model they
 * ran on) that happen to share the `--a0..--a6` color variables for
 * unrelated reasons (agent identity color vs. fixed per-tier color) — never
 * let them look like one shared legend, or a single-model session (the
 * common case) reads as a color mismatch between the two rollups.
 */
export function renderEconomics(s: SessionViewModel): string {
  const e = s.economics;
  if (e.totalTokens === 0) {
    return "";
  }
  return `
  <div class="section">
    <div class="lbl">Token economics <span class="line"></span><span class="count">by agent</span></div>
    <div class="econ">
      <div class="econ-top"><b>${formatTokens(e.totalTokens)}</b><u>tokens</u></div>
      <div class="estack">${renderStack(e)}</div>
      <div class="aroll">${e.byAgent.map(renderAgent).join("")}</div>
      <div class="roll-hdr">by model</div>
      <div class="mroll">${e.byModel.map(renderModel).join("")}</div>
      ${renderCache(e)}
    </div>
  </div>`;
}

function renderStack(e: EconomicsViewModel): string {
  return e.byAgent
    .map(
      (a) =>
        `<span style="flex:${a.tokens};background:var(--a${a.colorIndex})" title="${esc(a.label)} · ${formatTokens(
          a.tokens
        )}"></span>`
    )
    .join("");
}

/** One swatch in the bar's own legend — same `--a{colorIndex}` color as its
 *  stacked-bar segment, so agent identity reads as text, not hover-only. */
function renderAgent(a: EconomicsAgentSlice): string {
  return `<div><em style="background:var(--a${a.colorIndex})"></em>${esc(a.label)} <b>${formatTokens(a.tokens)}</b></div>`;
}

function renderModel(m: EconomicsModelSlice): string {
  const tier = modelTier(m.model);
  return `<div><em class="tier-${tier}"></em>${esc(shortLabel(m.model))} <b>${formatTokens(m.tokens)}</b></div>`;
}

function renderCache(e: EconomicsViewModel): string {
  if (e.cacheReadTokens === 0) {
    return "";
  }
  return `
  <div class="cache">
    <div class="cbar"><span style="width:${e.cacheSavedPct}%"></span></div>
    <span class="ctxt">◈ ${e.cacheSavedPct}% from cache · ${formatTokens(e.cacheReadTokens)} reused</span>
  </div>`;
}

function shortLabel(model: string): string {
  if (model === "unknown") {
    return "unknown";
  }
  const tier = modelTier(model);
  return tier === "other" ? model.replace(/^claude-/, "") : tier;
}
