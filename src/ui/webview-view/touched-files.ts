import { ToolCallRecord } from "../../core/types";
import { FileViewModel } from "./sidebar-messages";

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit"]);

/**
 * Derives the files a set of tool calls touched, most-recent-access wins,
 * deduped by path. Input is expected newest-first, so the first occurrence of a
 * path is its latest access. Used for both the session-level files panel and
 * each agent's drill-down.
 */
export function extractFiles(callsNewestFirst: readonly ToolCallRecord[]): FileViewModel[] {
  const byPath = new Map<string, FileViewModel>();
  for (const call of callsNewestFirst) {
    if (!FILE_TOOLS.has(call.name) || !call.detail || !looksLikePath(call.detail)) {
      continue;
    }
    if (byPath.has(call.detail)) {
      continue;
    }
    byPath.set(call.detail, {
      path: call.detail,
      base: basename(call.detail),
      dir: dirname(call.detail),
      access: call.name === "Read" ? "read" : "edit",
    });
  }
  return Array.from(byPath.values());
}

/** A file-tool's `detail` is its `file_path`, which can legitimately contain
 *  spaces (e.g. `~/Library/Application Support/...`). Only require it to be
 *  non-empty and path-shaped; the `FILE_TOOLS` gate already ensures it's a path. */
function looksLikePath(detail: string): boolean {
  return detail.length > 0 && (detail.includes("/") || detail.includes("\\") || detail.includes("."));
}

/** Last path separator index, handling both POSIX `/` and Windows `\`. */
function lastSep(p: string): number {
  return Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
}

function basename(p: string): string {
  const clean = p.replace(/[/\\]+$/, "");
  const i = lastSep(clean);
  return i >= 0 ? clean.slice(i + 1) : clean;
}

function dirname(p: string): string {
  const clean = p.replace(/[/\\]+$/, "");
  const i = lastSep(clean);
  return i > 0 ? clean.slice(0, i) : "";
}
