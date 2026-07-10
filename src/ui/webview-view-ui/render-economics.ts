import type {
  EconomicsModelSlice,
  EconomicsViewModel,
  SessionViewModel,
} from "../webview-view/sidebar-messages";
import { esc, formatTokens, modelTier } from "./dom-utils";

/** Token economics: stacked-by-agent bar, per-model rollup, cache-savings line. */
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
