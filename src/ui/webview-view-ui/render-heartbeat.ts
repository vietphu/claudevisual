import type { SessionViewModel } from "../webview-view/sidebar-messages";

/**
 * Activity heartbeat: one bar per recent tool call, colored by agent identity,
 * ordered oldest → newest. Bar heights vary deterministically by position for
 * an organic look — magnitude carries no meaning, only color (which agent) and
 * order (when) do. Hidden when the session has no recorded calls yet.
 */
export function renderHeartbeat(s: SessionViewModel): string {
  if (s.heartbeat.length === 0) {
    return "";
  }
  const bars = s.heartbeat
    .map((colorIndex, i) => {
      const height = 38 + ((i * 37 + colorIndex * 13) % 62); // 38%..99%, deterministic
      return `<i style="height:${height}%;background:var(--a${colorIndex})"></i>`;
    })
    .join("");
  return `
  <div class="section">
    <div class="lbl">Activity <span class="line"></span><span class="count">${s.heartbeat.length}</span></div>
    <div class="beat-wrap"><div class="beat" aria-hidden="true">${bars}</div></div>
  </div>`;
}
