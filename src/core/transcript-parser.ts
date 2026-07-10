import { ParsedLine, ParsedLineType } from "./types";

/**
 * Parses one raw JSONL line into a tolerant, loosely-typed record. Malformed
 * JSON is logged and skipped rather than thrown, since the transcript format
 * is not under our control and may gain new fields/types at any time.
 */
export function parseTranscriptLine(raw: string): ParsedLine | undefined {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    // Lazy-load logger to avoid vscode dependency in unit tests
    try {
      const { logDebug } = require("../diagnostics/logger");
      logDebug(`transcript-parser: skipping unparsable line: ${(err as Error).message}`);
    } catch {
      // Silently skip logging if logger is unavailable (e.g., during unit tests)
    }
    return undefined;
  }

  const type: ParsedLineType = typeof obj.type === "string" ? (obj.type as string) : "unknown";
  return {
    type,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
    cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
    raw: obj,
  };
}
