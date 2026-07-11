import * as vscode from "vscode";
import { logInfo } from "../diagnostics/logger";
import { EventLogReader, HookEventRecord, StatuslineCacheRecord } from "./event-log-reader";
import { JsonlLineEvent, JsonlTailer, SubagentMetaEvent } from "./jsonl-tailer";
import { applyHookEventOverlay, applyStatuslineOverlay, applySubagentMetaOverlay } from "./session-state-overlays";
import { listLiveSessionIds } from "./session-registry";
import { computeMetricsDiffs, MetricsSnapshot, SessionMetricsDiff } from "./session-metrics-diff";
import { sumUsage } from "./session-display";
import { reduceSessionState, reduceSubAgentLine } from "./state-reducer";
import { BurnRateTracker } from "./token-burn";
import { parseTranscriptLine } from "./transcript-parser";
import { ParsedLine } from "./transcript-types";
import { emptySessionState, SessionState } from "./types";

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
  private readonly burnRates = new BurnRateTracker();
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
      this.disposables.push(tailer.onSubagentMeta((event) => this.applySubagentMeta(event)));
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

  /** Fires ahead of the JSONL tailer for the same lifecycle transition — see {@link applyHookEventOverlay}. */
  private applyHookEvent(record: HookEventRecord): void {
    this.applyOverlay(record.sessionId, applyHookEventOverlay(this.states.get(record.sessionId), record));
  }

  /** Replaces the JSONL-derived approximation with precise data — see {@link applyStatuslineOverlay}. */
  private applyStatuslineUpdate(record: StatuslineCacheRecord): void {
    this.applyOverlay(record.sessionId, applyStatuslineOverlay(this.states.get(record.sessionId), record));
  }

  /** Authoritative type/spawn-reason/nesting for one sub-agent — see {@link applySubagentMetaOverlay}. */
  private applySubagentMeta(event: SubagentMetaEvent): void {
    this.applyOverlay(
      event.sessionId,
      applySubagentMetaOverlay(this.states.get(event.sessionId), event.sessionId, event.agentId, event.meta)
    );
  }

  private applyOverlay(sessionId: string, next: SessionState): void {
    this.states.set(sessionId, next);
    this.scheduleChangeEvent();
  }

  private scheduleChangeEvent(): void {
    if (this.debounceHandle) {
      return;
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = undefined;
      this.sampleBurnRates();
      this.emitter.fire(this.snapshot());
      const metricsDiffs = computeMetricsDiffs(this.states.values(), this.metricsSnapshots);
      if (metricsDiffs.length > 0) {
        this.metricsEmitter.fire(metricsDiffs);
      }
    }, CHANGE_DEBOUNCE_MS);
  }

  /**
   * Samples each session's cumulative token total into its bounded ring and
   * refreshes the display-only `burnRatePerMin`. Runs on the same debounced
   * tick as the change event (transcript-write driven) — the ring's own min-gap
   * keeps sample spacing sane regardless of append burstiness. Like `isLive`,
   * this is store-owned runtime state, set outside the pure reducer.
   */
  private sampleBurnRates(): void {
    const now = Date.now();
    for (const [id, state] of this.states) {
      const rate = this.burnRates.sample(id, now, sumUsage(state));
      if (state.burnRatePerMin !== rate) {
        this.states.set(id, { ...state, burnRatePerMin: rate });
      }
    }
  }

  private startLivePolling(): void {
    const poll = async () => {
      const liveIds = await listLiveSessionIds(this.workspaceCwds);
      const now = Date.now();
      let changed = false;
      for (const [id, state] of this.states) {
        const isLive = liveIds.has(id);
        // Re-evaluate burn staleness here too (not just on transcript ticks):
        // a finished/idle session stops writing lines, so without this its last
        // rate would linger forever.
        const burn = this.burnRates.recompute(id, now);
        if (state.isLive !== isLive || state.burnRatePerMin !== burn) {
          this.states.set(id, { ...state, isLive, burnRatePerMin: burn });
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
