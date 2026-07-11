import { SPAWN_TOOL_NAME } from "../../core/tool-use-parsing";
import { ToolCallRecord } from "../../core/types";
import { FeedItemViewModel, ToolCategory } from "./sidebar-messages";

/** Shapes one `ToolCallRecord` into the feed/drill-down item DTO the webview renders. */
export function toFeedItem(call: ToolCallRecord): FeedItemViewModel {
  return {
    name: call.name,
    detail: call.detail,
    category: categorize(call.name),
    time: formatClock(call.timestamp),
    spawn: call.name === SPAWN_TOOL_NAME,
  };
}

function categorize(name: string): ToolCategory {
  if (name === "Read" || name === "Grep" || name === "Glob") {
    return "read";
  }
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
    return "edit";
  }
  if (name === "Bash") {
    return "bash";
  }
  if (name === "TodoWrite" || name === SPAWN_TOOL_NAME) {
    return "flow";
  }
  if (name === "Skill") {
    return "agent";
  }
  return "other";
}

/** Local `HH:MM:SS` from a transcript timestamp — shared by the feed and the
 *  Activity heartbeat's hover tooltip so both read the same clock format. */
export function formatClock(ms: number): string {
  if (!ms || ms <= 0) {
    return "";
  }
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
}
