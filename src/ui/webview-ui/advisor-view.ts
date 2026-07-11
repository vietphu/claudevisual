import type {
  AdvisorReport,
  AdvisorReportDimension,
  AdvisorReportRecommendation,
} from "../webview/messages";
import { postToHost } from "./vscode-api";

/**
 * Dashboard Efficiency report: the retrospective view of the primary session —
 * grade + score, per-dimension breakdown, plan-aware cost figure, and the full
 * recommendation list. Renders into its own container; a null report (no session
 * yet) shows a muted placeholder.
 */
export class AdvisorView {
  constructor(private readonly root: HTMLElement) {
    // Delegated: `render()` replaces the whole subtree on every report push,
    // so a per-button listener would be lost on the next render.
    root.addEventListener("click", (event) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>(".adv-rec-copy");
      if (el) {
        this.handleCopy(el);
      }
    });
  }

  render(report: AdvisorReport | null): void {
    if (!report) {
      this.root.innerHTML = `<p class="adv-empty">No active session to analyze yet.</p>`;
      return;
    }
    this.root.innerHTML = this.markup(report);
  }

  /** Posts the clicked tip's prompt to the host as a "Copy" action, then
   *  briefly flashes the button label as feedback. */
  private handleCopy(el: HTMLElement): void {
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

  private markup(r: AdvisorReport): string {
    const gradeSev = gradeSeverity(r.grade);
    const scoreNum = r.neutral ? "—" : String(r.score);
    const cost = r.costDisplay
      ? `<span class="adv-cost" title="${esc(r.costTooltip)}">${esc(r.costDisplay)}</span>`
      : "";
    const model = r.model ? `<span class="adv-model">${esc(r.model)}</span>` : "";
    const recs =
      r.recommendations.length > 0
        ? r.recommendations.map(renderRec).join("")
        : `<p class="adv-clear">No efficiency issues detected — nicely run.</p>`;

    return `
      <div class="adv-report-head">
        <span class="adv-grade ${gradeSev}">${esc(r.grade)}</span>
        <div class="adv-report-meta">
          <div class="adv-report-title">Efficiency · <b>${esc(r.sessionLabel)}</b> ${model}</div>
          <div class="adv-report-sub">${scoreNum}<em>/100</em> ${cost}</div>
        </div>
      </div>
      <div class="adv-dims">${r.dimensions.map(renderDim).join("")}</div>
      <div class="adv-recs">${recs}</div>`;
  }
}

function renderDim(d: AdvisorReportDimension): string {
  const sev = scoreSeverity(d.score);
  return `<div class="adv-dim" title="${esc(d.label)}: ${d.score}/100">
    <span class="adv-dim-label">${esc(d.label)}</span>
    <span class="adv-dim-track"><span class="adv-dim-fill ${sev}" style="width:${clampPct(d.score)}%"></span></span>
    <span class="adv-dim-num">${d.score}</span>
  </div>`;
}

/** Feather-style "copy" glyph, inlined so the button needs no icon font/asset —
 *  `currentColor` picks up the button's own text color in both themes. */
const COPY_ICON = `<svg class="adv-rec-copy-ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

function renderRec(r: AdvisorReportRecommendation): string {
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
function buildAdvisorPrompt(r: AdvisorReportRecommendation): string {
  const head = r.metric ? `${r.title} (${r.metric})` : r.title;
  const parts = [`Efficiency Advisor tip: ${head}`];
  if (r.detail) {
    parts.push(r.detail);
  }
  parts.push("Please help me apply this to my current session.");
  return parts.join("\n\n");
}

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

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Local HTML escape (the dashboard client has no shared dom-utils). */
function esc(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
