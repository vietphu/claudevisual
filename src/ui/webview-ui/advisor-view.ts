import type {
  AdvisorReport,
  AdvisorReportDimension,
  AdvisorReportRecommendation,
} from "../webview/messages";

/**
 * Dashboard Efficiency report: the retrospective view of the primary session —
 * grade + score, per-dimension breakdown, plan-aware cost figure, and the full
 * recommendation list. Renders into its own container; a null report (no session
 * yet) shows a muted placeholder.
 */
export class AdvisorView {
  constructor(private readonly root: HTMLElement) {}

  render(report: AdvisorReport | null): void {
    if (!report) {
      this.root.innerHTML = `<p class="adv-empty">No active session to analyze yet.</p>`;
      return;
    }
    this.root.innerHTML = this.markup(report);
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

function renderRec(r: AdvisorReportRecommendation): string {
  const metric = r.metric ? `<span class="adv-rec-metric">${esc(r.metric)}</span>` : "";
  const detail = r.detail ? `<div class="adv-rec-detail">${esc(r.detail)}</div>` : "";
  return `<div class="adv-rec sev-${r.severity}">
    <div class="adv-rec-head">
      <span class="adv-rec-dot" aria-hidden="true"></span>
      <span class="adv-rec-cat">${esc(r.category)}</span>
      <span class="adv-rec-title">${esc(r.title)}</span>
      ${metric}
    </div>
    ${detail}
  </div>`;
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
