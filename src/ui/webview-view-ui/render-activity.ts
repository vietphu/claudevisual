import type { HeartbeatSample, SessionViewModel } from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";
import { renderFeedBody } from "./render-feed";
import { renderFilesBody } from "./render-files";

/**
 * Merged Activity section: a real timeline (bars positioned by actual
 * elapsed time between calls, not just call order — a lull in activity reads
 * as literal empty space on the chart) plus a click-to-expand detail panel
 * folding in the former separate "Recent activity" and "Files touched"
 * sections. Collapsed by default so the sidebar stays scannable at a glance;
 * toggled the same way as an Orchestration row's drill-down (click or
 * Enter/Space — see main.ts).
 */
export function renderActivity(s: SessionViewModel): string {
  if (s.heartbeat.length === 0 && s.feed.length === 0 && s.files.length === 0) {
    return "";
  }

  const feedBody = renderFeedBody(s);
  const filesBody = renderFilesBody(s);
  const hasDetail = feedBody.length > 0 || filesBody.length > 0;
  const detail = hasDetail
    ? `<div class="adetail">${
        feedBody ? `<div class="roll-hdr">recent activity · ${s.feed.length}</div>${feedBody}` : ""
      }${
        filesBody ? `<div class="roll-hdr">files touched · ${s.files.length}</div>${filesBody}` : ""
      }</div>`
    : "";
  const interactiveAttrs = hasDetail ? ` role="button" tabindex="0" aria-expanded="false"` : "";

  return `
  <div class="section activity${hasDetail ? " has-detail" : ""}" data-session="${esc(s.sessionId)}">
    <div class="lbl act-toggle"${interactiveAttrs}>Activity <span class="line"></span><span class="count">${s.heartbeat.length}</span></div>
    <div class="beat-wrap">${renderTimeline(s.heartbeat)}</div>
    ${detail}
  </div>`;
}

/**
 * Real timeline: each bar's horizontal position is proportional to its real
 * elapsed time within the visible window (first call → last call) — color is
 * agent identity (matches Orchestration), a light vertical grid marks even
 * quarters of the window, and the two edge labels ground it in actual clock
 * time. Bar height is uniform: there is no second real value left to encode,
 * so it never pretends to be one (the old deterministic-jitter height did,
 * and was confusing for it).
 */
function renderTimeline(heartbeat: readonly HeartbeatSample[]): string {
  if (heartbeat.length === 0) {
    return `<div class="beat"></div>`;
  }
  const first = heartbeat[0];
  const last = heartbeat[heartbeat.length - 1];
  const span = last.ts - first.ts;

  const bars = heartbeat
    .map((h) => {
      const pct = span > 0 ? ((h.ts - first.ts) / span) * 100 : 50;
      const title = `${h.label} · ${h.tool} · ${h.time}`;
      return `<i style="left:${pct}%;background:var(--a${h.colorIndex})" title="${esc(title)}"></i>`;
    })
    .join("");

  return `
    <div class="beat" aria-hidden="true">${bars}</div>
    <div class="beat-axis"><span>${esc(first.time)}</span><span>${esc(last.time)}</span></div>`;
}
