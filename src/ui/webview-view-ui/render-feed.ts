import type { FeedItemViewModel, SessionViewModel, ToolCategory } from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";

/** Monospace glyph per tool category — colored by the category CSS var. */
const CATEGORY_ICON: Record<ToolCategory, string> = {
  read: "◎",
  edit: "✎",
  bash: "›_",
  flow: "☑",
  agent: "◆",
  other: "•",
};

/** Recent-activity feed: color-coded, most-recent first, with spawn events
 *  (`Task`) given a distinct dashed treatment. */
export function renderFeed(s: SessionViewModel): string {
  if (s.feed.length === 0) {
    return "";
  }
  return `
  <div class="section">
    <div class="lbl">Recent activity <span class="line"></span><span class="count">${s.feed.length}</span></div>
    <div class="feed">${s.feed.map(renderFeedItem).join("")}</div>
  </div>`;
}

function renderFeedItem(item: FeedItemViewModel): string {
  const spawnClass = item.spawn ? " spawn" : "";
  const detail = item.detail ? `<div class="det">${esc(item.detail)}</div>` : "";
  return `
  <div class="call${spawnClass}" data-cat="${item.category}">
    <span class="ic">${CATEGORY_ICON[item.category]}</span>
    <div class="bd">
      <div class="l1"><span class="tool">${esc(item.name)}</span><span class="ts">${esc(item.time)}</span></div>
      ${detail}
    </div>
  </div>`;
}
