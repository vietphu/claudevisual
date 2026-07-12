import type { SessionViewModel } from "../webview-view/sidebar-messages";
import { esc, formatTokens, formatUsd, modelChip } from "./dom-utils";
import { gradeSeverity } from "./render-advisor";

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

/** `<span class="v-grade …">` Advisor grade badge for the collapsed row, or ""
 *  when the session hasn't done enough to score yet — lets a low-scoring
 *  session stand out in the list without expanding it. */
function gradeBadge(s: SessionViewModel): string {
  const a = s.advisor;
  if (a.neutral) {
    return "";
  }
  const sev = gradeSeverity(a.grade);
  return `<span class="v-grade ${sev}" title="Efficiency grade ${esc(a.grade)} (${a.score}/100) — open for details">${esc(a.grade)}</span>`;
}

/** Vitals header: live pulse, session name + id, model chip, Advisor grade badge, a
 *  full-width context meter (used/window tokens + %), and a single-row stat strip
 *  (tokens, cost, agents, burn rate). A horizontal meter reads the absolute + relative
 *  numbers in one line, where the previous ring could only fit the percent and needed
 *  a separate line below it.
 *  `.v-top` also doubles as the click/keyboard toggle for the session's collapsible body
 *  (Orchestration/Token Economics/Activity), with an explicit "View detail"/"Hide detail"
 *  button so the affordance to expand reads as a button, not just an implicit chevron —
 *  `expanded` is the initial `aria-expanded` the caller (`main.ts`) has already resolved
 *  for this render (collapsed by default, or a remembered manual override), not state
 *  this function owns. The card's frame (border + background wash) tints to the Advisor
 *  grade's severity color (once scored) so a low-scoring session is visible even collapsed. */
export function renderVitals(s: SessionViewModel, expanded: boolean): string {
  // A session started by `/clear` (or freshly opened) that hasn't done any real
  // work yet reads as "idle" identically to one that finished work and went
  // quiet — misleading users into thinking their prior session's data vanished.
  // Kept in sync by hand with `session-view-model.ts`'s own no-activity check
  // (different bundle, trivial one-liner — not worth a shared helper).
  const hasActivity = s.totalTokens > 0 || s.agents.length > 0 || s.feed.length > 0 || !!s.title;
  const isFresh = !hasActivity && (s.sessionStartSource === "clear" || s.sessionStartSource === "startup");
  const dotClass = isFresh ? "dot new" : s.running ? "dot running" : s.live ? "dot live" : "dot idle";
  const statusLabel = isFresh ? "new" : s.running ? "working" : s.live ? "live" : "idle";
  const ctxPct = `${s.contextPrecise ? "" : "~"}${s.contextPercent}%`;
  const sev = severityClass(s.contextPercent);
  const ctxDetail = `${formatTokens(s.contextUsedTokens)} / ${formatTokens(s.contextWindowTokens)} tokens`;
  const project = basename(s.cwd);
  const name = s.title || project || s.shortId;
  // Subtitle repeats the project name only when the headline is showing
  // something else (the ai-title) — otherwise it'd just echo the headline.
  // `esc()` runs once over the whole subtitle at the render site below, so
  // `clearedFrom` is interpolated raw here, not double-escaped.
  const clearedFromSuffix = s.clearedFrom ? ` · cleared from ${s.clearedFrom}` : "";
  const subtitle =
    (project && name !== project
      ? `${project} · ${s.shortId} · ${statusLabel}`
      : `${s.shortId} · ${statusLabel}`) + clearedFromSuffix;
  const cost =
    s.costUsd !== undefined
      ? `<div class="stat"><b class="good">${s.costEstimated ? "~" : ""}${formatUsd(s.costUsd)}</b><u>cost${s.costEstimated ? " · est" : ""}</u></div>`
      : "";
  const burn =
    s.running || s.burnRatePerMin !== undefined
      ? `<div class="stat"><b>${s.burnRatePerMin !== undefined ? `~${formatTokens(s.burnRatePerMin)}` : "—"}</b><u>tok/min</u></div>`
      : "";
  const gradeSev = s.advisor.neutral ? "" : ` grade-${gradeSeverity(s.advisor.grade)}`;

  return `
  <div class="vitals${gradeSev}">
    <div class="v-top" role="button" tabindex="0" aria-expanded="${expanded}">
      <span class="${dotClass}" aria-hidden="true" title="${statusLabel}"></span>
      <div class="v-head">
        <div class="v-name" title="${esc(s.cwd)}">${esc(name)}</div>
        <div class="v-id">${esc(subtitle)}</div>
      </div>
      ${gradeBadge(s)}
      ${modelChip(s.model)}
      <span class="v-toggle">${expanded ? "Hide detail" : "View detail"}</span>
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
