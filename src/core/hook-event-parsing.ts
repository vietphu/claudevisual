/**
 * Pure (vscode-free) parsing/derivation for the opt-in hooks event log and
 * statusline cache — split out of `event-log-reader.ts` so consumers that
 * only need these shapes (e.g. `session-state-overlays.ts`) don't transitively
 * pull in `vscode`, and so this logic is unit-testable outside the extension host.
 */

/** One normalized record appended by `../hooks/hook-scripts/emit-event.cjs`,
 *  one per Claude Code hook invocation. Keep this shape in sync with that
 *  script's `buildRecord`. */
export interface HookEventRecord {
  ts: number;
  sessionId: string;
  hookEvent?: string;
  toolName?: string;
  agentId?: string;
  agentType?: string;
  permissionMode?: string;
}

/** One parsed snapshot of `statusline-cache.json` — the precise
 *  `context_window.used_percentage` / `cost.total_cost_usd` overlay Phase 4's
 *  statusline wrap provides, in place of the JSONL-derived approximation. */
export interface StatuslineCacheRecord {
  sessionId: string;
  ts: number;
  contextUsedPercent: number | undefined;
  costUsd: number | undefined;
}

/** Hook events that mean "Claude is actively working" on this session. */
const RUNNING_HOOK_EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart"]);
/** Hook events that mean the session just returned control to the user, or restarted idle. */
const IDLE_HOOK_EVENTS = new Set(["Stop", "SessionStart", "SubagentStop"]);

/**
 * Maps one `hookEvent` to the "running" overlay bit. Returns `undefined` for
 * event names this reader has no opinion on (future/custom hook events) —
 * callers should keep the previous known value rather than guess.
 */
export function deriveRunningState(hookEvent: string | undefined): boolean | undefined {
  if (!hookEvent) {
    return undefined;
  }
  if (RUNNING_HOOK_EVENTS.has(hookEvent)) {
    return true;
  }
  if (IDLE_HOOK_EVENTS.has(hookEvent)) {
    return false;
  }
  return undefined;
}

/** Validates + narrows one NDJSON line to a {@link HookEventRecord}. Malformed
 *  or incomplete lines are dropped rather than thrown — schema drift in the
 *  event log must never crash the reader. */
export function parseHookEventLine(line: string): HookEventRecord | undefined {
  if (line.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line) as Partial<HookEventRecord>;
    if (typeof parsed.sessionId !== "string" || typeof parsed.ts !== "number") {
      return undefined;
    }
    return {
      ts: parsed.ts,
      sessionId: parsed.sessionId,
      hookEvent: typeof parsed.hookEvent === "string" ? parsed.hookEvent : undefined,
      toolName: typeof parsed.toolName === "string" ? parsed.toolName : undefined,
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      agentType: typeof parsed.agentType === "string" ? parsed.agentType : undefined,
      permissionMode: typeof parsed.permissionMode === "string" ? parsed.permissionMode : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Validates + narrows one whole-file read of `statusline-cache.json` — the
 * raw statusLine hook payload `../hooks/hook-scripts/statusline-wrap.cjs`
 * tees verbatim — to a {@link StatuslineCacheRecord}. Mirrors the Claude Code
 * statusLine stdin schema's `session_id` (snake_case, API-native) and nested
 * `context_window.used_percentage` / `cost.total_cost_usd` fields. Malformed
 * or incomplete payloads are dropped rather than thrown, matching
 * {@link parseHookEventLine} — schema drift here must never crash the reader.
 */
export function parseStatuslineCache(raw: string): StatuslineCacheRecord | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const sessionId = parsed["session_id"];
    if (typeof sessionId !== "string") {
      return undefined;
    }
    const contextWindow = parsed["context_window"] as Record<string, unknown> | undefined;
    const cost = parsed["cost"] as Record<string, unknown> | undefined;
    const contextUsedPercent =
      typeof contextWindow?.["used_percentage"] === "number" ? (contextWindow["used_percentage"] as number) : undefined;
    const costUsd = typeof cost?.["total_cost_usd"] === "number" ? (cost["total_cost_usd"] as number) : undefined;

    return { sessionId, ts: Date.now(), contextUsedPercent, costUsd };
  } catch {
    return undefined;
  }
}
