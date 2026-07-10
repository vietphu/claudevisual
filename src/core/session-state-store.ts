import * as vscode from "vscode";
import { logInfo } from "../diagnostics/logger";
import { deriveRunningState, EventLogReader, HookEventRecord, StatuslineCacheRecord } from "./event-log-reader";
import { JsonlLineEvent, JsonlTailer } from "./jsonl-tailer";
import { listLiveSessionIds } from "./session-registry";
import { computeMetricsDiffs, MetricsSnapshot, SessionMetricsDiff } from "./session-metrics-diff";
import { reduceSessionState, reduceSubAgentLine } from "./state-reducer";
import { parseTranscriptLine } from "./transcript-parser";
import { emptySessionState, ParsedLine, SessionState } from "./types";

export type { SessionMetricsDiff } from "./session-metrics-diff";

const LIVE_POLL_INTERVAL_MS = 5000;
const CHANGE_DEBOUNCE_MS = 150;

/**
 * Keyed live view of every session seen in the tailed transcripts, merged
 * with a low-frequency liveness poll against the session registry. Change
 * notifications are debounced so a burst of JSONL appends collapses into a
 * single UI re-render.
 */
export class SessionStateStore implements vscode.Disposable {
  private readonly states = new Map<string, SessionState>();
  private readonly emitter = new vscode.EventEmitter<SessionState[]>();
  private readonly metricsEmitter = new vscode.EventEmitter<SessionMetricsDiff[]>();
  private readonly metricsSnapshots = new Map<string, MetricsSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private debounceHandle: ReturnType<typeof setTimeout> | undefined;
  private livePollHandle: ReturnType<typeof setInterval> | undefined;

  readonly onDidChange = this.emitter.event;
  /** Incremental per-session diffs for the dashboard's charts (Phase 5) — see {@link SessionMetricsDiff}. */
  readonly onDidChangeMetrics = this.metricsEmitter.event;

  /**
   * Fed by one tailer per open workspace folder, but always renders into a
   * single merged view — never one store (and one status-bar render) per
   * folder, which would make the displayed session non-deterministically
   * depend on which folder's transcript happened to write last.
   *
   * `eventLogReader` is optional: when hooks (Phase 3) are installed, its
   * events overlay a low-latency `running` bit onto whatever state the
   * JSONL tailers have derived so far — ahead of the transcript line
   * actually landing on disk.
   */
  constructor(
    tailers: readonly JsonlTailer[],
    private readonly workspaceCwds: readonly string[],
    eventLogReader?: EventLogReader
  ) {
    for (const tailer of tailers) {
      this.disposables.push(tailer.onLine((event) => this.handleLine(event)));
    }
    if (eventLogReader) {
      this.disposables.push(eventLogReader.onEvent((record) => this.applyHookEvent(record)));
      this.disposables.push(eventLogReader.onStatuslineUpdate((record) => this.applyStatuslineUpdate(record)));
    }
    this.startLivePolling();
  }

  snapshot(): SessionState[] {
    return Array.from(this.states.values());
  }

  private handleLine(event: JsonlLineEvent): void {
    const parsed = parseTranscriptLine(event.line);
    if (!parsed) {
      return;
    }

    // Sub-agent transcript lines are tagged by the tailer with the parent
    // sessionId + agentId derived from their file path, not from the JSON
    // payload — route them into that session's `subagents` map instead of
    // treating them as a top-level session update.
    if (event.sessionId && event.agentId) {
      this.handleSubagentLine(event.sessionId, event.agentId, parsed);
      return;
    }

    if (!parsed.sessionId) {
      return;
    }
    if (!this.states.has(parsed.sessionId)) {
      logInfo(`session-state-store: new session ${parsed.sessionId} (cwd=${parsed.cwd ?? "unknown"})`);
    }
    const previous =
      this.states.get(parsed.sessionId) ?? emptySessionState(parsed.sessionId, parsed.cwd ?? "");
    this.states.set(parsed.sessionId, reduceSessionState(previous, parsed));
    this.scheduleChangeEvent();
  }

  private handleSubagentLine(sessionId: string, agentId: string, parsed: ParsedLine): void {
    const previous = this.states.get(sessionId);
    if (!previous) {
      // Parent session not yet known (rare startup race) — drop; a
      // subsequent line from either transcript re-establishes state.
      return;
    }
    this.states.set(sessionId, reduceSubAgentLine(previous, agentId, parsed));
    this.scheduleChangeEvent();
  }

  /**
   * Overlays one hook-log event onto the session's `running` state. Fires
   * ahead of the JSONL tailer for the same lifecycle transition, which is
   * the entire point of the opt-in hooks path. If the session isn't known
   * yet (the hook can win the race against the transcript line landing), a
   * minimal placeholder is synthesized so the low-latency signal isn't
   * dropped — the JSONL tailer fills in the rest of the state once its line
   * arrives.
   */
  private applyHookEvent(record: HookEventRecord): void {
    const previous = this.states.get(record.sessionId);
    const nextRunning = deriveRunningState(record.hookEvent) ?? previous?.running ?? false;
    const base = previous ?? emptySessionState(record.sessionId, "");

    this.states.set(record.sessionId, {
      ...base,
      running: nextRunning,
      lastHookEvent: record.hookEvent ?? base.lastHookEvent,
      lastHookEventAt: record.ts,
      lastUpdatedAt: Math.max(base.lastUpdatedAt, record.ts),
    });
    this.scheduleChangeEvent();
  }

  /**
   * Overlays one `statusline-cache.json` snapshot (Phase 4) onto the
   * session's precise context%/cost fields, replacing the JSONL-derived
   * approximation for display purposes. Same race-tolerant placeholder
   * synthesis as {@link applyHookEvent}: the statusline tick can win against
   * the transcript line establishing the session first.
   */
  private applyStatuslineUpdate(record: StatuslineCacheRecord): void {
    const previous = this.states.get(record.sessionId);
    const base = previous ?? emptySessionState(record.sessionId, "");

    this.states.set(record.sessionId, {
      ...base,
      preciseContextPercent: record.contextUsedPercent ?? base.preciseContextPercent,
      preciseCostUsd: record.costUsd ?? base.preciseCostUsd,
      preciseStatusLineUpdatedAt: record.ts,
      lastUpdatedAt: Math.max(base.lastUpdatedAt, record.ts),
    });
    this.scheduleChangeEvent();
  }

  private scheduleChangeEvent(): void {
    if (this.debounceHandle) {
      return;
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = undefined;
      this.emitter.fire(this.snapshot());
      const metricsDiffs = computeMetricsDiffs(this.states.values(), this.metricsSnapshots);
      if (metricsDiffs.length > 0) {
        this.metricsEmitter.fire(metricsDiffs);
      }
    }, CHANGE_DEBOUNCE_MS);
  }

  private startLivePolling(): void {
    const poll = async () => {
      const liveIds = await listLiveSessionIds(this.workspaceCwds);
      let changed = false;
      for (const [id, state] of this.states) {
        const isLive = liveIds.has(id);
        if (state.isLive !== isLive) {
          this.states.set(id, { ...state, isLive });
          changed = true;
        }
      }
      if (changed) {
        this.emitter.fire(this.snapshot());
      }
    };
    void poll();
    this.livePollHandle = setInterval(() => void poll(), LIVE_POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
    }
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
    this.metricsEmitter.dispose();
  }
}
