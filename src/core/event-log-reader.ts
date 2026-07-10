import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { logDebug, logError, logInfo } from "../diagnostics/logger";

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

export function eventLogDir(): string {
  return path.join(os.homedir(), ".claude", "claudevisual");
}

/** Filename `../hooks/hook-scripts/statusline-wrap.cjs` atomically overwrites
 *  on every statusline tick. Kept in sync with that script's hardcoded path
 *  (it's a standalone `.cjs` — it cannot import this constant). */
export const STATUSLINE_CACHE_FILENAME = "statusline-cache.json";

/** One parsed snapshot of `statusline-cache.json` — the precise
 *  `context_window.used_percentage` / `cost.total_cost_usd` overlay Phase 4's
 *  statusline wrap provides, in place of the JSONL-derived approximation. */
export interface StatuslineCacheRecord {
  sessionId: string;
  ts: number;
  contextUsedPercent: number | undefined;
  costUsd: number | undefined;
}

const PARTIAL_LINE_FLUSH_MS = 1000;

/**
 * Offset-tracked tail of `~/.claude/claudevisual/events-*.ndjson` — the
 * opt-in, low-latency NDJSON log `emit-event.cjs` appends to once
 * `src/hooks/installer.ts` has installed the hooks. Mirrors `JsonlTailer`'s
 * byte-offset + partial-line-buffering technique so re-reads cost only the
 * appended bytes, never the whole file. Purely additive: if hooks were
 * never installed, `dir` doesn't exist and this reader just stays idle.
 */
export class EventLogReader implements vscode.Disposable {
  private readonly offsets = new Map<string, number>();
  private readonly partialLines = new Map<string, string>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly emitter = new vscode.EventEmitter<HookEventRecord>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private started = false;

  /** Separate from `inFlight`/`offsets` above: `statusline-cache.json` is a
   *  single-file overwrite (Phase 4), not an append-only NDJSON log, so it's
   *  always re-read in full on change rather than offset-tracked. */
  private readonly statuslineInFlight = new Map<string, Promise<void>>();
  private readonly statuslineEmitter = new vscode.EventEmitter<StatuslineCacheRecord>();
  private statuslineWatcher: vscode.FileSystemWatcher | undefined;

  readonly onEvent = this.emitter.event;
  readonly onStatuslineUpdate = this.statuslineEmitter.event;

  constructor(private readonly dir: string = eventLogDir()) {}

  /** Idempotent — safe to call more than once; only the first call does anything. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    logInfo(`event-log-reader: watching ${this.dir}`);
    const pattern = new vscode.RelativePattern(this.dir, "events-*.ndjson");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange((uri) => void this.enqueueRead(uri.fsPath));
    this.watcher.onDidCreate((uri) => void this.enqueueRead(uri.fsPath));

    const statuslinePattern = new vscode.RelativePattern(this.dir, STATUSLINE_CACHE_FILENAME);
    this.statuslineWatcher = vscode.workspace.createFileSystemWatcher(statuslinePattern);
    this.statuslineWatcher.onDidChange((uri) => void this.enqueueStatuslineRead(uri.fsPath));
    this.statuslineWatcher.onDidCreate((uri) => void this.enqueueStatuslineRead(uri.fsPath));

    void this.primeExisting();
  }

  /** Reads every event log file already on disk from its start. Unlike the
   *  whole-project JSONL transcripts, these files are small — bounded by one
   *  session's hook traffic — so a full read at activation is cheap. Also
   *  primes `statusline-cache.json` if the statusline wrap was already
   *  installed and ticked before this VS Code session started. */
  private async primeExisting(): Promise<void> {
    if (!fs.existsSync(this.dir)) {
      logInfo(`event-log-reader: ${this.dir} does not exist — hooks not installed, staying idle`);
      return;
    }
    const entries = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    const files = entries.filter((e) => e.startsWith("events-") && e.endsWith(".ndjson"));
    for (const file of files) {
      await this.enqueueRead(path.join(this.dir, file));
    }
    if (entries.includes(STATUSLINE_CACHE_FILENAME)) {
      await this.enqueueStatuslineRead(path.join(this.dir, STATUSLINE_CACHE_FILENAME));
    }
  }

  private enqueueRead(filePath: string): Promise<void> {
    const prior = this.inFlight.get(filePath) ?? Promise.resolve();
    const next = prior
      .then(() => this.readAppended(filePath))
      .catch((err) => logError(`event-log-reader: failed reading ${filePath}`, err));
    this.inFlight.set(filePath, next);
    return next;
  }

  private async readAppended(filePath: string): Promise<void> {
    const stat = await fs.promises.stat(filePath).catch(() => undefined);
    if (!stat) {
      return; // file removed/rotated between the watch event firing and this read
    }
    const previousOffset = this.offsets.get(filePath) ?? 0;

    if (stat.size < previousOffset) {
      logDebug(`event-log-reader: ${filePath} shrank — resetting offset (rotated/truncated)`);
      this.offsets.set(filePath, 0);
      this.partialLines.delete(filePath);
      return this.readAppended(filePath);
    }
    if (stat.size === previousOffset) {
      return;
    }

    const chunk = await this.readRange(filePath, previousOffset, stat.size);
    this.offsets.set(filePath, stat.size);
    this.emitCompleteLines(filePath, chunk);
  }

  private emitCompleteLines(filePath: string, chunk: string): void {
    const combined = (this.partialLines.get(filePath) ?? "") + chunk;
    const lines = combined.split("\n");
    const trailing = lines.pop() ?? "";
    this.partialLines.set(filePath, trailing);

    let emitted = 0;
    for (const line of lines) {
      const record = parseHookEventLine(line.trim());
      if (record) {
        this.emitter.fire(record);
        emitted++;
      }
    }
    logDebug(`event-log-reader: emitted ${emitted} event(s) from ${filePath}`);

    this.rescheduleTrailingFlush(filePath, trailing);
  }

  /** Promotes a buffered partial line to "complete" after a period of silence
   *  — a hook process's very last write before exit isn't guaranteed to end in `\n`. */
  private rescheduleTrailingFlush(filePath: string, trailing: string): void {
    const existingTimer = this.flushTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.flushTimers.delete(filePath);
    }
    if (trailing.trim().length === 0) {
      return;
    }
    this.flushTimers.set(
      filePath,
      setTimeout(() => {
        this.flushTimers.delete(filePath);
        const pending = this.partialLines.get(filePath)?.trim();
        if (pending) {
          this.partialLines.set(filePath, "");
          const record = parseHookEventLine(pending);
          if (record) {
            this.emitter.fire(record);
          }
        }
      }, PARTIAL_LINE_FLUSH_MS)
    );
  }

  private enqueueStatuslineRead(filePath: string): Promise<void> {
    const prior = this.statuslineInFlight.get(filePath) ?? Promise.resolve();
    const next = prior
      .then(() => this.readStatuslineCache(filePath))
      .catch((err) => logError(`event-log-reader: failed reading statusline cache ${filePath}`, err));
    this.statuslineInFlight.set(filePath, next);
    return next;
  }

  /** Re-reads `statusline-cache.json` in full — it's overwritten wholesale on
   *  every statusline tick by `statusline-wrap.cjs`, never appended to, so
   *  there's no byte offset to track (unlike the NDJSON event logs above). */
  private async readStatuslineCache(filePath: string): Promise<void> {
    const content = await fs.promises.readFile(filePath, "utf8").catch(() => undefined);
    if (content === undefined) {
      return; // file removed/rotated between the watch event firing and this read
    }
    const record = parseStatuslineCache(content);
    if (record) {
      this.statuslineEmitter.fire(record);
    }
  }

  private readRange(filePath: string, start: number, end: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      const stream = fs.createReadStream(filePath, { start, end: end - 1, encoding: "utf8" });
      stream.on("data", (c) => (data += c));
      stream.on("end", () => resolve(data));
      stream.on("error", reject);
    });
  }

  dispose(): void {
    this.watcher?.dispose();
    this.emitter.dispose();
    this.statuslineWatcher?.dispose();
    this.statuslineEmitter.dispose();
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
  }
}

/** Validates + narrows one NDJSON line to a {@link HookEventRecord}. Malformed
 *  or incomplete lines are dropped rather than thrown — schema drift in the
 *  event log must never crash the reader. */
function parseHookEventLine(line: string): HookEventRecord | undefined {
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
function parseStatuslineCache(raw: string): StatuslineCacheRecord | undefined {
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
