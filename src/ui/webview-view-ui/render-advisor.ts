import type {
  AdvisorRecommendationViewModel,
  AdvisorViewModel,
  SessionViewModel,
} from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";
import { postToHost } from "./sidebar-vscode-api";

/**
 * Efficiency Advisor section: a grade + score meter, then the ranked
 * recommendation list. Mirrors the visual language of the context meter in
 * `render-vitals.ts` (good/warn/crit bands) so the two never disagree.
 *
 * Hidden entirely when there's nothing to say: a neutral (just-started) session
 * with no recommendations renders "" so the section doesn't add noise before any
 * signal exists.
 */
export function renderAdvisor(s: SessionViewModel): string {
  const a = s.advisor;
  if (a.neutral && a.recommendations.length === 0) {
    return "";
  }
  const gradeSev = gradeSeverity(a.grade);
  const cost = a.costDisplay
    ? `<span class="adv-cost" title="${esc(a.costTooltip)}">${esc(a.costDisplay)}</span>`
    : "";
  const recs =
    a.recommendations.length > 0
      ? `<div class="adv-recs">${a.recommendations.map(renderRec).join("")}</div>`
      : `<div class="adv-clear">No efficiency issues detected.</div>`;

  return `
  <div class="section advisor">
    <div class="lbl">Advisor <span class="line"></span><span class="count">${esc(recCount(a))}</span></div>
    <div class="adv">
      <div class="adv-score">
        <span class="adv-grade ${gradeSev}" title="Efficiency score ${a.neutral ? "(pending)" : a.score}">${esc(a.grade)}</span>
        <div class="adv-score-body">
          <div class="adv-score-row">
            <span class="adv-score-num">${a.neutral ? "—" : a.score}<em>/100</em></span>
            ${cost}
          </div>
          <div class="adv-dims">${a.dimensions.map(renderDim).join("")}</div>
        </div>
      </div>
      ${recs}
    </div>
  </div>`;
}

function recCount(a: AdvisorViewModel): string {
  const n = a.recommendations.length;
  if (n === 0) {
    return "all clear";
  }
  const crit = a.recommendations.filter((r) => r.severity === "critical").length;
  return crit > 0 ? `${crit} critical · ${n} total` : `${n} tip${n === 1 ? "" : "s"}`;
}

/** One dimension as a slim labelled bar. */
function renderDim(d: { label: string; score: number }): string {
  const sev = scoreSeverity(d.score);
  return `<div class="adv-dim" title="${esc(d.label)}: ${d.score}/100">
    <span class="adv-dim-label">${esc(d.label)}</span>
    <span class="adv-dim-track"><span class="adv-dim-fill ${sev}" style="width:${Math.max(0, Math.min(100, d.score))}%"></span></span>
  </div>`;
}

/** Feather-style "copy" glyph, inlined so the button needs no icon font/asset —
 *  `currentColor` picks up the button's own text color in both themes. */
const COPY_ICON = `<svg class="adv-rec-copy-ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

function renderRec(r: AdvisorRecommendationViewModel): string {
  const metric = r.metric ? `<span class="adv-rec-metric">${esc(r.metric)}</span>` : "";
  const detail = r.detail ? `<div class="adv-rec-detail">${esc(r.detail)}</div>` : "";
  const prompt = esc(buildAdvisorPrompt(r));
  return `<div class="adv-rec sev-${r.severity}">
    <div class="adv-rec-head">
      <span class="adv-rec-dot" aria-hidden="true"></span>
      <span class="adv-rec-cat">${esc(r.category)}</span>
      <span class="adv-rec-title">${esc(r.title)}</span>
      ${metric}
      <span class="adv-rec-copy" role="button" tabindex="0" data-prompt="${prompt}" title="Copy as a prompt">${COPY_ICON}Copy</span>
    </div>
    ${detail}
  </div>`;
}

/** Turns a recommendation into text meant for pasting straight into a Claude
 *  Code chat — the rule text itself reads as advice to the user, so this wraps
 *  it into something addressed to Claude instead of just dumping raw fields. */
function buildAdvisorPrompt(r: AdvisorRecommendationViewModel): string {
  const head = r.metric ? `${r.title} (${r.metric})` : r.title;
  const parts = [`Efficiency Advisor tip: ${head}`];
  if (r.detail) {
    parts.push(r.detail);
  }
  parts.push("Please help me apply this to my current session.");
  return parts.join("\n\n");
}

/** Posts a clicked `.adv-rec-copy` button's prompt (carried in `data-prompt`,
 *  set by `renderRec` above) to the host, then briefly flashes the label as
 *  feedback — the host's own clipboard write has no other visible echo here. */
export function handleAdvisorAction(el: HTMLElement): void {
  const text = el.dataset.prompt;
  if (!text) {
    return;
  }
  postToHost({ type: "advisor-copy", text });
  const original = el.innerHTML;
  el.textContent = "Copied";
  el.classList.add("flash");
  window.setTimeout(() => {
    el.innerHTML = original;
    el.classList.remove("flash");
  }, 1200);
}

/** Grade → color band, matching the context meter's good/warn/crit palette. */
function gradeSeverity(grade: string): "good" | "warn" | "crit" {
  if (grade === "A" || grade === "B") {
    return "good";
  }
  if (grade === "C" || grade === "D") {
    return "warn";
  }
  return "crit";
}

function scoreSeverity(score: number): "good" | "warn" | "crit" {
  if (score >= 75) {
    return "good";
  }
  if (score >= 50) {
    return "warn";
  }
  return "crit";
}
