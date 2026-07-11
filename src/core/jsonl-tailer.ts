import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { logDebug, logError, logInfo } from "../diagnostics/logger";
import { SubagentFileRegistry } from "./subagent-file-registry";

export interface JsonlLineEvent {
  filePath: string;
  line: string;
  /**
   * Set only for lines read from a sub-agent transcript
   * (`<sessionId>/subagents/agent-<agentId>.jsonl`). Absent for root-level
   * session transcript lines, which carry their own `sessionId` inside the
   * JSON payload instead — consumers must branch on this field's presence
   * rather than always trusting the parsed JSON's `sessionId`.
   */
  sessionId?: string;
  agentId?: string;
}

export type { SubagentMetaEvent } from "./subagent-file-registry";

const PRIME_TAIL_BYTES = 2_000_000;
const PARTIAL_LINE_FLUSH_MS = 1000;

/**
 * Tails every `*.jsonl` file directly under `dir`, emitting one event per
 * complete line as it's appended. Never re-reads a whole file: tracks a
 * byte offset per path and reads only `[offset, size)` on each change,
 * buffering any trailing partial line until a newline completes it (or,
 * failing that, until `PARTIAL_LINE_FLUSH_MS` of silence — a transcript's
 * very last write before process exit is not guaranteed to end in `\n`).
 */
export class JsonlTailer implements vscode.Disposable {
  private readonly offsets = new Map<string, number>();
  private readonly partialLines = new Map<string, string>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Serializes reads per file path so overlapping watcher/prime events can't race on `offsets`. */
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly emitter = new vscode.EventEmitter<JsonlLineEvent>();
  private readonly watcher: vscode.FileSystemWatcher;
  /** One narrow watcher per known session's `subagents/*.jsonl`, added lazily via
   *  `addSessionSubagentWatcher` — never a broad/recursive watch of `this.dir`. */
  private readonly sessionWatchers = new Map<string, vscode.FileSystemWatcher>();
  /** Tracks sub-agent transcript file identity + `.meta.json` sidecar discovery
   *  (see `core/subagent-file-registry.ts`). */
  private readonly subagentFiles = new SubagentFileRegistry();

  readonly onLine = this.emitter.event;
  /** Fired once per sub-agent whose `.meta.json` sidecar becomes readable. */
  readonly onSubagentMeta = this.subagentFiles.onSubagentMeta;

  constructor(private readonly dir: string) {
    logInfo(`jsonl-tailer: watching ${dir}`);
    const pattern = new vscode.RelativePattern(dir, "*.jsonl");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange((uri) => void this.enqueueRead(uri.fsPath));
    this.watcher.onDidCreate((uri) => void this.enqueueRead(uri.fsPath));
  }

  /**
   * Backfills only the single most-recently-modified transcript, and only its
   * last `PRIME_TAIL_BYTES` — never a full historical replay. Some project
   * directories on disk hold hundreds of past sessions totaling hundreds of
   * megabytes; reading all of that at activation would itself violate the
   * "never slow Claude down" constraint this extension exists to respect.
   * Older/other concurrently-active sessions are still picked up live via
   * the watcher from the moment of activation onward — they just don't get
   * a historical backfill.
   */
  async primeExisting(): Promise<void> {
    if (!fs.existsSync(this.dir)) {
      logInfo(`jsonl-tailer: ${this.dir} does not exist — nothing to prime`);
      return;
    }
    const entries = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    const candidates = entries.filter((e) => e.endsWith(".jsonl")).map((e) => path.join(this.dir, e));
    if (candidates.length === 0) {
      logInfo(`jsonl-tailer: ${this.dir} has no .jsonl files — nothing to prime`);
      return;
    }

    const withMtime = await Promise.all(
      candidates.map(async (filePath) => {
        const stat = await fs.promises.stat(filePath).catch(() => undefined);
        return { filePath, mtimeMs: stat?.mtimeMs ?? 0 };
      })
    );
    const newest = withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!newest) {
      return;
    }

    const stat = await fs.promises.stat(newest.filePath).catch(() => undefined);
    if (!stat) {
      return;
    }
    logInfo(`jsonl-tailer: priming ${newest.filePath} (${stat.size} bytes)`);
    this.offsets.set(newest.filePath, Math.max(0, stat.size - PRIME_TAIL_BYTES));
    await this.enqueueRead(newest.filePath);
  }

  /**
   * Registers a narrow watcher for exactly one known session's
   * `subagents/*.jsonl` directory, and primes any sub-agent transcripts
   * already on disk for it. Idempotent — safe to call on every store change
   * for every known session; a no-op after the first call for a given id.
   */
  addSessionSubagentWatcher(sessionId: string): void {
    if (this.sessionWatchers.has(sessionId)) {
      return;
    }
    const subagentsDir = path.join(this.dir, sessionId, "subagents");
    const pattern = new vscode.RelativePattern(subagentsDir, "*.jsonl");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onEvent = (uri: vscode.Uri) => {
      this.subagentFiles.register(uri.fsPath, sessionId);
      this.subagentFiles.maybeEmitMeta(uri.fsPath);
      void this.enqueueRead(uri.fsPath);
    };
    watcher.onDidChange(onEvent);
    watcher.onDidCreate(onEvent);
    this.sessionWatchers.set(sessionId, watcher);
    logInfo(`jsonl-tailer: watching subagents for session ${sessionId}`);
    void this.primeSubagentFiles(subagentsDir, sessionId);
  }

  /** Disposes the sub-agent watcher for one session, if one was registered. */
  disposeSessionSubagentWatcher(sessionId: string): void {
    const watcher = this.sessionWatchers.get(sessionId);
    if (!watcher) {
      return;
    }
    watcher.dispose();
    this.sessionWatchers.delete(sessionId);
    logDebug(`jsonl-tailer: stopped watching subagents for session ${sessionId}`);
  }

  /** Primes every sub-agent transcript already on disk for one session. Unlike
   * `primeExisting` (newest-file-only, whole-project scope), this reads every
   * file in the session's own `subagents/` dir — that directory is naturally
   * small (bounded by how many Agent calls one session makes). */
  private async primeSubagentFiles(subagentsDir: string, sessionId: string): Promise<void> {
    if (!fs.existsSync(subagentsDir)) {
      return;
    }
    const entries = await fs.promises.readdir(subagentsDir).catch(() => [] as string[]);
    const files = entries.filter((e) => e.endsWith(".jsonl")).map((e) => path.join(subagentsDir, e));
    for (const filePath of files) {
      this.subagentFiles.register(filePath, sessionId);
      this.subagentFiles.maybeEmitMeta(filePath);
      const stat = await fs.promises.stat(filePath).catch(() => undefined);
      if (!stat) {
        continue;
      }
      this.offsets.set(filePath, Math.max(0, stat.size - PRIME_TAIL_BYTES));
      await this.enqueueRead(filePath);
    }
  }

  private enqueueRead(filePath: string): Promise<void> {
    const prior = this.inFlight.get(filePath) ?? Promise.resolve();
    const next = prior
      .then(() => this.readAppended(filePath))
      .catch((err) => logError(`jsonl-tailer: failed reading ${filePath}`, err));
    this.inFlight.set(filePath, next);
    return next;
  }

  private async readAppended(filePath: string): Promise<void> {
    const stat = await fs.promises.stat(filePath);

    if (!this.offsets.has(filePath)) {
      // First live touch on a file this tailer never explicitly primed — e.g.
      // an older session resumed via `claude --resume` in another terminal,
      // whose transcript wasn't the single newest-mtime file `primeExisting()`
      // chose to backfill at activation. Seek to the same tail window
      // `primeExisting()` uses rather than defaulting to 0, so this first
      // touch can never trigger a full historical read of a potentially huge
      // transcript — the exact cost `primeExisting()`'s own newest-file-only
      // scope exists to avoid, just reintroduced at a different trigger point.
      this.offsets.set(filePath, Math.max(0, stat.size - PRIME_TAIL_BYTES));
    }

    const previousOffset = this.offsets.get(filePath) ?? 0;

    if (stat.size < previousOffset) {
      logDebug(`jsonl-tailer: ${filePath} shrank — resetting offset (rotated/truncated)`);
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

    const meta = this.subagentFiles.lookup(filePath);
    let emitted = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.emitter.fire({ filePath, line: trimmed, sessionId: meta?.sessionId, agentId: meta?.agentId });
        emitted++;
      }
    }
    logDebug(`jsonl-tailer: emitted ${emitted} line(s) from ${filePath}`);

    this.rescheduleTrailingFlush(filePath, trailing);
  }

  /** Promotes a buffered partial line to "complete" after a period of silence. */
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
          const meta = this.subagentFiles.lookup(filePath);
          this.emitter.fire({ filePath, line: pending, sessionId: meta?.sessionId, agentId: meta?.agentId });
        }
      }, PARTIAL_LINE_FLUSH_MS)
    );
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
    this.watcher.dispose();
    for (const watcher of this.sessionWatchers.values()) {
      watcher.dispose();
    }
    this.sessionWatchers.clear();
    this.emitter.dispose();
    this.subagentFiles.dispose();
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
  }
}
